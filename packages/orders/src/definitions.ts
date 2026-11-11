/**
 * Order constants and validation. Safe to import in the browser.
 * Money math comes from the invoicing module, so an order and its invoice always agree.
 */
import {
  addDays,
  CURRENCIES,
  computeTotals,
  formatMoney,
  isDay,
  lineInputSchema,
  today,
} from "@templates/invoicing/definitions"
import { z } from "zod"

export { addDays, CURRENCIES, computeTotals, formatMoney, today }

export const ORDER_STATUSES = ["draft", "confirmed", "fulfilled", "cancelled"] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const STATUS_LABELS: Record<OrderStatus, string> = {
  draft: "Draft",
  confirmed: "Confirmed",
  fulfilled: "Fulfilled",
  cancelled: "Cancelled",
}

export const EVENT_LABELS = {
  created: "Created",
  edited: "Edited",
  confirmed: "Confirmed",
  fulfilled: "Fulfilled",
  cancelled: "Cancelled",
  invoiced: "Invoiced",
  note: "Note",
} as const

export const MAX_LINES = 200
export const isEditable = (s: OrderStatus) => s === "draft" || s === "confirmed"

const text = (max: number) =>
  z
    .string()
    .nullish()
    .transform((v) => (v ?? "").trim())
    .pipe(z.string().max(max, `Keep it under ${max} characters`))
    .transform((v) => v || null)

const day = z
  .string()
  .nullish()
  .transform((v) => v?.trim() || null)
  .refine((v) => v === null || isDay(v), "Pick a date")

const optionalId = (message: string) =>
  z
    .string()
    .nullish()
    .transform((v) => v?.trim() || null)
    .refine((v) => v === null || z.uuid().safeParse(v).success, message)

export const orderLineSchema = lineInputSchema.extend({
  productId: optionalId("Choose a product from the list"),
})
export type OrderLineInput = z.input<typeof orderLineSchema>

export const orderInputSchema = z
  .object({
    customerId: z.uuid("Choose a customer"),
    orderDate: day.refine((v) => v !== null, "Pick a date"),
    requestedOn: day,
    locationId: optionalId("Choose a location from the list"),
    currency: z.enum(CURRENCIES, "Choose a currency"),
    shippingAddress: text(500),
    notes: text(2000),
    lines: z
      .array(orderLineSchema)
      .min(1, "Add at least one line")
      .max(MAX_LINES, `At most ${MAX_LINES} lines`),
  })
  .refine((v) => !v.requestedOn || !v.orderDate || v.requestedOn >= v.orderDate, {
    path: ["requestedOn"],
    message: "Can't be before the order date",
    when: ({ value }) => {
      const v = value as { orderDate?: unknown; requestedOn?: unknown }
      return typeof v.orderDate === "string" && typeof v.requestedOn === "string"
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
export type OrderInput = z.input<typeof orderInputSchema>

export const reasonSchema = z
  .string()
  .nullish()
  .transform((v) => (v ?? "").trim())
  .pipe(z.string().min(1, "Say why it's cancelled").max(500, "Keep it under 500 characters"))

export const noteSchema = z
  .string()
  .nullish()
  .transform((v) => (v ?? "").trim())
  .pipe(z.string().min(1, "Write a note").max(2000, "Keep it under 2000 characters"))

export const orderFilterSchema = z.object({
  status: z.enum(ORDER_STATUSES).optional().catch(undefined),
  /** Confirmed orders whose requested date is today or earlier. */
  due: z.enum(["1"]).optional().catch(undefined),
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
export type OrderFilter = z.input<typeof orderFilterSchema>

export function fieldErrors(error: z.ZodError) {
  const out: Record<string, string> = {}
  for (const i of error.issues) out[i.path.join(".") || "_form"] ??= i.message
  return out
}
