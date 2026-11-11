/**
 * Invoicing constants, money math and validation. Safe to import in the browser:
 * the editor shows totals with the exact functions the server stores.
 */
import { CURRENCIES, formatMoney } from "@templates/crm/definitions"
import { z } from "zod"

export { CURRENCIES, formatMoney }

export const INVOICE_KINDS = ["quote", "invoice"] as const
export const INVOICE_STATUSES = ["draft", "sent", "accepted", "declined", "void"] as const
export const PAYMENT_METHODS = ["cash", "bank_transfer", "card", "check", "other"] as const

export type InvoiceKind = (typeof INVOICE_KINDS)[number]
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const MAX_LINES = 100

export const KIND_LABELS: Record<InvoiceKind, string> = { quote: "Quote", invoice: "Invoice" }
export const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  card: "Card",
  check: "Check",
  other: "Other",
}

/** What a person sees: the stored status combined with the money and the date. */
export type InvoiceState =
  | "draft"
  | "open"
  | "partial"
  | "overdue"
  | "paid"
  | "void"
  | "sent"
  | "accepted"
  | "declined"
  | "expired"

export const STATE_LABELS: Record<InvoiceState, string> = {
  draft: "Draft",
  open: "Open",
  partial: "Partly paid",
  overdue: "Overdue",
  paid: "Paid",
  void: "Void",
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
}

export const INVOICE_FILTER_STATES = ["draft", "open", "overdue", "paid", "void"] as const
export const QUOTE_FILTER_STATES = ["draft", "sent", "accepted", "declined", "void"] as const

export function invoiceState(
  inv: {
    kind: InvoiceKind
    status: InvoiceStatus
    dueOn: string | null
    totalCents: number
    amountPaidCents: number
  },
  todayStr: string,
): InvoiceState {
  if (inv.status === "draft" || inv.status === "void") return inv.status
  if (inv.kind === "quote") {
    if (inv.status === "sent" && inv.dueOn && inv.dueOn < todayStr) return "expired"
    return inv.status === "accepted" || inv.status === "declined" ? inv.status : "sent"
  }
  if (inv.amountPaidCents >= inv.totalCents) return "paid"
  if (inv.dueOn && inv.dueOn < todayStr) return "overdue"
  return inv.amountPaidCents > 0 ? "partial" : "open"
}

// ---------- Dates ----------

/** Today in a timezone (default: the runtime's), as YYYY-MM-DD. */
export function today(timeZone?: string, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, dateStyle: "short" }).format(now)
}

export function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function isDay(s: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)).toISOString().slice(0, 10) === s
}

// ---------- Money math (integers only) ----------

/** "-1,250.5" → -125050. Negative prices are allowed for discount lines. */
export function parseSignedMoney(input: string): number | null {
  const s = input.replace(/[\s,]/g, "")
  const m = /^(-)?(\d{1,11})(?:\.(\d{1,2}))?$/.exec(s)
  if (!m) return null
  const cents = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0"))
  return m[1] && cents !== 0 ? -cents : cents
}

/** "1.5" → 1500 (thousandths). Must be more than zero. */
export function parseQuantity(input: string): number | null {
  const m = /^(\d{1,7})(?:\.(\d{1,3}))?$/.exec(input.replace(/[\s,]/g, ""))
  if (!m) return null
  const milli = Number(m[1]) * 1000 + Number((m[2] ?? "").padEnd(3, "0"))
  return milli > 0 ? milli : null
}

/** "12" or "12.5" (percent) → 1200 or 1250 basis points. 0–100%. */
export function parsePercent(input: string): number | null {
  const s = input.replace(/[\s%]/g, "") || "0"
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(s)
  if (!m) return null
  const bp = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"))
  return bp <= 10_000 ? bp : null
}

export const formatQuantity = (milli: number) =>
  (milli / 1000).toLocaleString("en", { maximumFractionDigits: 3 })
export const formatPercent = (bp: number) =>
  `${(bp / 100).toLocaleString("en", { maximumFractionDigits: 2 })}%`
/** Cents as a plain editable string: 125050 → "1250.50". */
export const centsToInput = (cents: number) => (cents / 100).toFixed(2)

/** a × b ÷ d, rounded half away from zero, in exact integer arithmetic. */
function mulDivRound(a: number, b: number, d: number) {
  const n = BigInt(a) * BigInt(b)
  const neg = n < 0n
  const abs = neg ? -n : n
  const q = (abs * 2n + BigInt(d)) / (2n * BigInt(d))
  return Number(neg ? -q : q)
}

export const lineAmount = (quantityMilli: number, unitPriceCents: number) =>
  mulDivRound(quantityMilli, unitPriceCents, 1000)
export const lineTax = (amountCents: number, taxRateBp: number) =>
  mulDivRound(amountCents, taxRateBp, 10_000)

export type LineValues = { quantityMilli: number; unitPriceCents: number; taxRateBp: number }

/** Per-line amounts and document totals. Tax is rounded per line, then summed. */
export function computeTotals<L extends LineValues>(lines: L[]) {
  const computed = lines.map((l) => {
    const amountCents = lineAmount(l.quantityMilli, l.unitPriceCents)
    return { ...l, amountCents, taxCents: lineTax(amountCents, l.taxRateBp) }
  })
  const subtotalCents = computed.reduce((s, l) => s + l.amountCents, 0)
  const taxCents = computed.reduce((s, l) => s + l.taxCents, 0)
  return { lines: computed, subtotalCents, taxCents, totalCents: subtotalCents + taxCents }
}

// ---------- Inputs ----------

const text = (max: number) =>
  z
    .string()
    .nullish()
    .transform((v) => (v ?? "").trim())
    .pipe(z.string().max(max, `Keep it under ${max} characters`))
    .transform((v) => v || null)

const day = (message = "Pick a date") =>
  z
    .string()
    .nullish()
    .transform((v) => v?.trim() || null)
    .refine((v) => v === null || isDay(v), message)

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

export const lineInputSchema = z.object({
  description: z
    .string()
    .nullish()
    .transform((v) => (v ?? "").trim())
    .pipe(z.string().min(1, "Describe the item").max(500, "Keep it under 500 characters")),
  quantity: parsed(parseQuantity, "Enter a quantity like 1 or 2.5", "1"),
  unitPrice: parsed(parseSignedMoney, "Enter a price like 120 or 99.50"),
  taxRate: parsed(parsePercent, "Enter a rate from 0 to 100", "0"),
})
export type LineInput = z.input<typeof lineInputSchema>

export const invoiceInputSchema = z
  .object({
    customerId: z.uuid("Choose a customer"),
    issueDate: day().refine((v) => v !== null, "Pick a date"),
    dueOn: day(),
    currency: z.enum(CURRENCIES, "Choose a currency"),
    notes: text(2000),
    terms: text(2000),
    lines: z
      .array(lineInputSchema)
      .min(1, "Add at least one line")
      .max(MAX_LINES, `At most ${MAX_LINES} lines`),
  })
  .refine((v) => !v.dueOn || !v.issueDate || v.dueOn >= v.issueDate, {
    path: ["dueOn"],
    message: "Can't be before the issue date",
    // Check the dates even while a line has an error, so every problem shows at once.
    when: ({ value }) => {
      const v = value as { issueDate?: unknown; dueOn?: unknown }
      return typeof v.issueDate === "string" && typeof v.dueOn === "string"
    },
  })
  .refine(
    (v) =>
      computeTotals(
        v.lines.map((l) => ({
          quantityMilli: l.quantity,
          unitPriceCents: l.unitPrice,
          taxRateBp: l.taxRate,
        })),
      ).totalCents >= 0,
    { path: ["lines"], message: "Discounts can't make the total negative" },
  )
export type InvoiceInput = z.input<typeof invoiceInputSchema>

export const paymentInputSchema = z.object({
  amount: parsed((s) => {
    const n = parseSignedMoney(s)
    return n !== null && n > 0 ? n : null
  }, "Enter an amount more than zero"),
  paidOn: day().refine((v) => v !== null, "Pick a date"),
  method: z.enum(PAYMENT_METHODS, "Choose how it was paid"),
  reference: text(100),
  note: text(500),
})
export type PaymentInput = z.input<typeof paymentInputSchema>

const prefix = z
  .string()
  .trim()
  .max(12, "Keep it under 12 characters")
  .regex(/^[A-Za-z0-9/_-]*$/, "Letters, numbers, - / and _ only")

export const settingsInputSchema = z.object({
  invoicePrefix: prefix,
  quotePrefix: prefix,
  nextInvoiceNumber: z.coerce.number("Enter a number").int().min(1).max(99_999_999),
  nextQuoteNumber: z.coerce.number("Enter a number").int().min(1).max(99_999_999),
  defaultDueDays: z.coerce
    .number("Enter a number")
    .int()
    .min(0, "0 or more")
    .max(365, "At most 365"),
  defaultTaxRate: parsed(parsePercent, "Enter a rate from 0 to 100", "0"),
  defaultCurrency: z.enum(CURRENCIES, "Choose a currency"),
  businessName: text(120),
  businessDetails: text(1000),
  paymentInstructions: text(1000),
  footer: text(500),
})
export type SettingsInput = z.input<typeof settingsInputSchema>

export const invoiceFilterSchema = z.object({
  kind: z.enum(INVOICE_KINDS).catch("invoice").default("invoice"),
  state: z
    .enum([...new Set([...INVOICE_FILTER_STATES, ...QUOTE_FILTER_STATES])] as [string, ...string[]])
    .optional()
    .catch(undefined),
  customer: z.uuid().optional().catch(undefined),
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .catch(undefined)
    .transform((v) => v || undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
})
export type InvoiceFilter = z.input<typeof invoiceFilterSchema>

export function fieldErrors(error: z.ZodError) {
  const out: Record<string, string> = {}
  for (const i of error.issues) out[i.path.join(".") || "_form"] ??= i.message
  return out
}

export const formatNumber = (prefix: string, n: number) => `${prefix}${String(n).padStart(4, "0")}`
