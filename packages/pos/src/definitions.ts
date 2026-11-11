/**
 * Point-of-sale constants, money math and validation. Safe to import in the browser,
 * so the till shows exactly the totals the server will charge.
 */
import {
  addDays,
  CURRENCIES,
  formatMoney,
  formatPercent,
  formatQuantity,
  isDay,
  lineAmount,
  parsePercent,
  parseQuantity,
  parseSignedMoney,
  today,
} from "@templates/invoicing/definitions"
import { z } from "zod"

export {
  addDays,
  CURRENCIES,
  formatMoney,
  formatPercent,
  formatQuantity,
  isDay,
  parsePercent,
  parseQuantity,
  today,
}

export const TENDERS = ["cash", "card", "other"] as const
export type Tender = (typeof TENDERS)[number]
export const TENDER_LABELS: Record<Tender, string> = {
  cash: "Cash",
  card: "Card",
  other: "Other",
}

export const CASH_MOVEMENT_KINDS = ["paid_in", "paid_out"] as const
export type CashMovementKind = (typeof CASH_MOVEMENT_KINDS)[number]
export const CASH_MOVEMENT_LABELS: Record<CashMovementKind, string> = {
  paid_in: "Cash in",
  paid_out: "Cash out",
}

export const MAX_LINES = 200
export const MAX_PAYMENTS = 10

// ---------- Money math (integers only) ----------

/** a × b ÷ d, rounded half away from zero, in exact integer arithmetic. */
export function mulDivRound(a: number, b: number, d: number) {
  const n = BigInt(a) * BigInt(b)
  const neg = n < 0n
  const abs = neg ? -n : n
  const q = (abs * 2n + BigInt(d)) / (2n * BigInt(d))
  return Number(neg ? -q : q)
}

/** "12.50" → 1250. Zero allowed, never negative. */
export function parseMoney(input: string): number | null {
  const n = parseSignedMoney(input)
  return n === null || n < 0 ? null : n
}

export const centsToInput = (cents: number) => (cents / 100).toFixed(2)

export type TaxMode = { taxRateBp: number; pricesIncludeTax: boolean }

/**
 * One till line. `subtotal` is shelf price × quantity; the discount comes off
 * that; tax is either inside the price (VAT-style) or added on top. Every
 * figure is rounded once, per line, so the receipt always adds up.
 */
export function computeLine(
  l: { quantityMilli: number; unitPriceCents: number; discountBp: number },
  tax: TaxMode,
) {
  const subtotalCents = lineAmount(l.quantityMilli, l.unitPriceCents)
  const discountCents = mulDivRound(subtotalCents, l.discountBp, 10_000)
  const afterDiscount = subtotalCents - discountCents
  const taxCents = tax.pricesIncludeTax
    ? mulDivRound(afterDiscount, tax.taxRateBp, 10_000 + tax.taxRateBp)
    : mulDivRound(afterDiscount, tax.taxRateBp, 10_000)
  const totalCents = tax.pricesIncludeTax ? afterDiscount : afterDiscount + taxCents
  return { subtotalCents, discountCents, taxCents, totalCents, taxRateBp: tax.taxRateBp }
}

export function computeCart<
  L extends { quantityMilli: number; unitPriceCents: number; discountBp: number },
>(lines: L[], tax: TaxMode) {
  const computed = lines.map((l) => ({ ...l, ...computeLine(l, tax) }))
  const sum = (k: "subtotalCents" | "discountCents" | "taxCents" | "totalCents") =>
    computed.reduce((s, l) => s + l[k], 0)
  return {
    lines: computed,
    subtotalCents: sum("subtotalCents"),
    discountCents: sum("discountCents"),
    taxCents: sum("taxCents"),
    totalCents: sum("totalCents"),
  }
}

export type TenderInput = { tender: Tender; tenderedCents: number; reference?: string | null }

/**
 * Applies what the customer handed over to the total. Card and other payments
 * can't go over the total; only cash can, and the difference is change.
 */
export function settlePayments(totalCents: number, payments: TenderInput[]) {
  const nonCash = payments.filter((p) => p.tender !== "cash")
  const nonCashSum = nonCash.reduce((s, p) => s + p.tenderedCents, 0)
  const cashSum = payments.reduce((s, p) => s + (p.tender === "cash" ? p.tenderedCents : 0), 0)
  const paid = nonCashSum + cashSum
  if (payments.some((p) => !Number.isInteger(p.tenderedCents) || p.tenderedCents <= 0))
    return { ok: false as const, error: "Each payment must be more than zero" }
  if (nonCashSum > totalCents)
    return { ok: false as const, error: "Card and other payments can't be more than the total" }
  if (paid < totalCents)
    return { ok: false as const, error: "still_due", dueCents: totalCents - paid }
  let change = paid - totalCents
  const changeCents = change
  // Give change from the cash payments, last one first.
  const settled = payments.map((p) => ({ ...p, amountCents: p.tenderedCents, changeCents: 0 }))
  for (let i = settled.length - 1; i >= 0 && change > 0; i--) {
    const p = settled[i]
    if (!p || p.tender !== "cash") continue
    const give = Math.min(change, p.tenderedCents)
    p.changeCents = give
    p.amountCents = p.tenderedCents - give
    change -= give
  }
  return {
    ok: true as const,
    changeCents,
    // A cash note that went entirely to change put nothing toward the sale.
    payments: settled.filter((p) => p.amountCents > 0),
  }
}

/**
 * What to give back for `quantityMilli` of a line. The last refund of a line
 * gets whatever is left, so refunding everything always returns exactly what
 * was paid, never a cent more or less.
 */
export function refundAmount(
  line: {
    quantityMilli: number
    totalCents: number
    refundedQtyMilli: number
    refundedCents: number
  },
  quantityMilli: number,
) {
  const remainingQty = line.quantityMilli - line.refundedQtyMilli
  const remainingCents = line.totalCents - line.refundedCents
  if (quantityMilli >= remainingQty) return remainingCents
  return Math.min(remainingCents, mulDivRound(line.totalCents, quantityMilli, line.quantityMilli))
}

export type SaleState = "paid" | "partly_refunded" | "refunded"
export const SALE_STATE_LABELS: Record<SaleState, string> = {
  paid: "Paid",
  partly_refunded: "Partly refunded",
  refunded: "Refunded",
}
export function saleState(s: { totalCents: number; refundedCents: number; refundedAll?: boolean }) {
  if (s.refundedAll || (s.totalCents > 0 && s.refundedCents >= s.totalCents)) return "refunded"
  return s.refundedCents > 0 ? "partly_refunded" : "paid"
}

export function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz })
    return tz.length > 0 && tz.length <= 64
  } catch {
    return false
  }
}

// ---------- Inputs ----------

const text = (max: number) =>
  z
    .string()
    .nullish()
    .transform((v) => (v ?? "").trim())
    .pipe(z.string().max(max, `Keep it under ${max} characters`))
    .transform((v) => v || null)

const required = (max: number, message: string) =>
  z
    .string()
    .nullish()
    .transform((v) => (v ?? "").trim())
    .pipe(z.string().min(1, message).max(max, `Keep it under ${max} characters`))

const optionalId = (message: string) =>
  z
    .string()
    .nullish()
    .transform((v) => v?.trim() || null)
    .refine((v) => v === null || z.uuid().safeParse(v).success, message)

const parsed = (parse: (s: string) => number | null, message: string, fallback = "") =>
  z
    .union([z.string(), z.number()])
    .nullish()
    .transform((v, ctx) => {
      const n = parse(v === null || v === undefined || v === "" ? fallback : String(v))
      if (n === null) {
        ctx.addIssue({ code: "custom", message })
        return z.NEVER
      }
      return n
    })

const money = (message = "Enter an amount like 100 or 99.50", fallback = "") =>
  parsed(parseMoney, message, fallback)
const positiveMoney = (message: string) =>
  parsed((s) => {
    const n = parseMoney(s)
    return n && n > 0 ? n : null
  }, message)

export const settingsInputSchema = z.object({
  receiptPrefix: z
    .string()
    .trim()
    .min(1, "Enter a prefix")
    .max(10, "Keep it under 10 characters")
    .regex(/^[A-Za-z0-9/_-]+$/, "Letters, numbers, - _ / only"),
  currency: z.enum(CURRENCIES, "Choose a currency"),
  taxRate: parsed(parsePercent, "Enter a rate from 0 to 100", "0"),
  pricesIncludeTax: z
    .boolean()
    .nullish()
    .transform((v) => !!v),
  maxDiscount: parsed(parsePercent, "Enter a percent from 0 to 100", "0"),
  timeZone: z.string().trim().refine(isValidTimeZone, "Choose a valid time zone"),
  receiptHeader: text(300),
  receiptFooter: text(300),
})
export type SettingsInput = z.input<typeof settingsInputSchema>

export const registerInputSchema = z.object({
  name: required(60, "Name the register"),
  locationId: z.uuid("Choose where it sells from"),
})
export type RegisterInput = z.input<typeof registerInputSchema>

export const openShiftSchema = z.object({
  openingFloat: money("Enter the cash in the drawer, like 0 or 1000", "0"),
})
export type OpenShiftInput = z.input<typeof openShiftSchema>

export const cashMovementSchema = z.object({
  kind: z.enum(CASH_MOVEMENT_KINDS, "Choose in or out"),
  amount: positiveMoney("Enter an amount more than zero"),
  reason: required(200, "Say what it's for"),
})
export type CashMovementInput = z.input<typeof cashMovementSchema>

export const closeShiftSchema = z.object({
  countedCash: money("Enter the cash you counted"),
  note: text(500),
})
export type CloseShiftInput = z.input<typeof closeShiftSchema>

export const cartLineSchema = z
  .object({
    productId: optionalId("Choose a product from the list"),
    /** Only used for custom items. Product lines use the product's name. */
    description: text(200),
    quantity: parsed(parseQuantity, "Enter a quantity like 1 or 2.5", "1"),
    /** Only used for custom items. Product lines always use the shelf price. */
    unitPrice: z.union([z.string(), z.number()]).nullish(),
    discount: parsed(parsePercent, "Enter a discount from 0 to 100%", "0"),
  })
  .superRefine((l, ctx) => {
    if (l.productId) return
    if (!l.description)
      ctx.addIssue({ code: "custom", path: ["description"], message: "Describe the item" })
    const p = parseMoney(
      l.unitPrice === null || l.unitPrice === undefined ? "" : String(l.unitPrice),
    )
    if (p === null)
      ctx.addIssue({
        code: "custom",
        path: ["unitPrice"],
        message: "Enter a price like 120 or 99.50",
      })
  })
export type CartLineInput = z.input<typeof cartLineSchema>

export const paymentInputSchema = z.object({
  tender: z.enum(TENDERS, "Choose how they paid"),
  amount: positiveMoney("Enter an amount more than zero"),
  reference: text(100),
})
export type PaymentInput = z.input<typeof paymentInputSchema>

export const checkoutSchema = z.object({
  registerId: z.uuid("Choose a register"),
  /** Made by the till once per sale; resending it returns the same sale. */
  clientKey: z.uuid("Missing sale key"),
  customerId: optionalId("Choose a customer from the list"),
  note: text(500),
  lines: z
    .array(cartLineSchema)
    .min(1, "Add something to the sale")
    .max(MAX_LINES, `At most ${MAX_LINES} lines`),
  payments: z.array(paymentInputSchema).max(MAX_PAYMENTS, `At most ${MAX_PAYMENTS} payments`),
})
export type CheckoutInput = z.input<typeof checkoutSchema>

export const refundInputSchema = z.object({
  registerId: z.uuid("Choose the register giving the refund"),
  tender: z.enum(TENDERS, "Choose how the money goes back"),
  reason: required(300, "Say why it's refunded"),
  restock: z
    .boolean()
    .nullish()
    .transform((v) => !!v),
  lines: z
    .array(
      z.object({
        lineId: z.uuid(),
        quantity: parsed(parseQuantity, "Enter a quantity like 1"),
      }),
    )
    .min(1, "Choose what's coming back")
    .max(MAX_LINES),
})
export type RefundInput = z.input<typeof refundInputSchema>

export const saleFilterSchema = z.object({
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .catch(undefined)
    .transform((v) => v || undefined),
  register: z.uuid().optional().catch(undefined),
  day: z
    .string()
    .optional()
    .catch(undefined)
    .refine((v) => v === undefined || isDay(v))
    .catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
})
export type SaleFilter = z.input<typeof saleFilterSchema>

export function fieldErrors(error: z.ZodError) {
  const out: Record<string, string> = {}
  for (const i of error.issues) out[i.path.join(".") || "_form"] ??= i.message
  return out
}
