/**
 * Inventory constants, quantity helpers and validation. Safe to import in the browser.
 */
import { CURRENCIES, formatMoney, parseMoney } from "@templates/crm/definitions"
import { z } from "zod"

export { CURRENCIES, formatMoney }

export const MOVEMENT_KINDS = ["receive", "issue", "transfer_out", "transfer_in", "count"] as const
export type MovementKind = (typeof MOVEMENT_KINDS)[number]

export const KIND_LABELS: Record<MovementKind, string> = {
  receive: "Received",
  issue: "Issued",
  transfer_out: "Transferred out",
  transfer_in: "Transferred in",
  count: "Counted",
}

export const ISSUE_REASONS = ["sold", "used", "damaged", "expired", "returned", "other"] as const
export type IssueReason = (typeof ISSUE_REASONS)[number]
export const REASON_LABELS: Record<IssueReason, string> = {
  sold: "Sold",
  used: "Used internally",
  damaged: "Damaged",
  expired: "Expired",
  returned: "Returned to supplier",
  other: "Other",
}

// ---------- Quantities (thousandths) ----------

/** "2.5" → 2500. Up to 3 decimals. */
export function parseQuantity(input: string, opts: { allowZero?: boolean } = {}): number | null {
  const m = /^(\d{1,9})(?:\.(\d{1,3}))?$/.exec(input.replace(/[\s,]/g, ""))
  if (!m) return null
  const milli = Number(m[1]) * 1000 + Number((m[2] ?? "").padEnd(3, "0"))
  if (milli === 0 && !opts.allowZero) return null
  return milli
}

export const formatQuantity = (milli: number, unit?: string) =>
  `${(milli / 1000).toLocaleString("en", { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ""}`

/** Value of a quantity at a unit cost, rounded to the cent. */
export const stockValue = (milli: number, unitCents: number) =>
  Number((BigInt(milli) * BigInt(unitCents) * 2n + 1000n) / 2000n)

export type StockStatus = "out" | "low" | "ok"
export function stockStatus(onHandMilli: number, reorderPointMilli: number): StockStatus {
  if (onHandMilli <= 0) return "out"
  if (reorderPointMilli > 0 && onHandMilli <= reorderPointMilli) return "low"
  return "ok"
}

/** How much to order: the reorder quantity, or at least enough to get back above the point. */
export function suggestedOrder(
  onHandMilli: number,
  reorderPointMilli: number,
  reorderQtyMilli: number,
) {
  return Math.max(reorderQtyMilli, reorderPointMilli - onHandMilli + 1000, 0)
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

const qty = (message: string, opts: { allowZero?: boolean; fallback?: string } = {}) =>
  z
    .union([z.string(), z.number()])
    .nullish()
    .transform((v, ctx) => {
      const raw = v === null || v === undefined || v === "" ? (opts.fallback ?? "") : String(v)
      const n = parseQuantity(raw, opts)
      if (n === null) {
        ctx.addIssue({ code: "custom", message })
        return z.NEVER
      }
      return n
    })

const money = (fallback = "0") =>
  z
    .union([z.string(), z.number()])
    .nullish()
    .transform((v, ctx) => {
      const n = parseMoney(v === null || v === undefined || v === "" ? fallback : String(v))
      if (n === null) {
        ctx.addIssue({ code: "custom", message: "Enter an amount like 12 or 12.50" })
        return z.NEVER
      }
      return n
    })

const id = (message: string) => z.uuid(message)

export const productInputSchema = z.object({
  sku: required(40, "Give it a SKU").pipe(
    z.string().regex(/^[A-Za-z0-9._/-]+$/, "Letters, numbers, . _ / and - only"),
  ),
  name: required(120, "Give it a name"),
  description: text(2000),
  category: text(60),
  barcode: text(64).refine(
    (v) => v === null || /^[A-Za-z0-9-]+$/.test(v),
    "Letters and numbers only",
  ),
  unit: required(12, "Enter a unit like pcs or kg"),
  currency: z.enum(CURRENCIES, "Choose a currency"),
  cost: money(),
  price: money(),
  reorderPoint: qty("Enter a quantity like 10", { allowZero: true, fallback: "0" }),
  reorderQty: qty("Enter a quantity like 50", { allowZero: true, fallback: "0" }),
})
export type ProductInput = z.input<typeof productInputSchema>

export const locationInputSchema = z.object({
  name: required(80, "Give the location a name"),
  address: text(500),
})
export type LocationInput = z.input<typeof locationInputSchema>

const reference = text(100)
const note = text(500)

export const receiveInputSchema = z.object({
  locationId: id("Choose a location"),
  quantity: qty("Enter how many, more than zero"),
  unitCost: z
    .union([z.string(), z.number()])
    .nullish()
    .transform((v, ctx) => {
      if (v === null || v === undefined || v === "") return null
      const n = parseMoney(String(v))
      if (n === null) {
        ctx.addIssue({ code: "custom", message: "Enter an amount like 12 or 12.50" })
        return z.NEVER
      }
      return n
    }),
  reference,
  note,
})
export type ReceiveInput = z.input<typeof receiveInputSchema>

export const issueInputSchema = z.object({
  locationId: id("Choose a location"),
  quantity: qty("Enter how many, more than zero"),
  reason: z.enum(ISSUE_REASONS, "Choose a reason"),
  reference,
  note,
})
export type IssueInput = z.input<typeof issueInputSchema>

export const transferInputSchema = z
  .object({
    fromLocationId: id("Choose where it's coming from"),
    toLocationId: id("Choose where it's going"),
    quantity: qty("Enter how many, more than zero"),
    note,
  })
  .refine((v) => v.fromLocationId !== v.toLocationId, {
    path: ["toLocationId"],
    message: "Pick a different location",
  })
export type TransferInput = z.input<typeof transferInputSchema>

export const countInputSchema = z.object({
  locationId: id("Choose a location"),
  counted: qty("Enter the quantity you counted (0 or more)", { allowZero: true }),
  note,
})
export type CountInput = z.input<typeof countInputSchema>

export const productFilterSchema = z.object({
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .catch(undefined)
    .transform((v) => v || undefined),
  category: z.string().trim().max(60).optional().catch(undefined),
  stock: z.enum(["low", "out"]).optional().catch(undefined),
  status: z.enum(["active", "archived"]).catch("active").default("active"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
})
export type ProductFilter = z.input<typeof productFilterSchema>

const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))

export const movementFilterSchema = z.object({
  product: z.uuid().optional().catch(undefined),
  location: z.uuid().optional().catch(undefined),
  kind: z.enum(MOVEMENT_KINDS).optional().catch(undefined),
  from: z.string().refine(isDay).optional().catch(undefined),
  to: z.string().refine(isDay).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
})
export type MovementFilter = z.input<typeof movementFilterSchema>

export function fieldErrors(error: z.ZodError) {
  const out: Record<string, string> = {}
  for (const i of error.issues) out[i.path.join(".") || "_form"] ??= i.message
  return out
}
