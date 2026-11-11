/**
 * Booking constants and validation. Safe to import in the browser.
 */
import { CURRENCIES, formatMoney, parseMoney } from "@templates/crm/definitions"
import { z } from "zod"

import { isValidTimeZone, parseClock } from "./time"

export * from "./time"
export { CURRENCIES, formatMoney }

export const BOOKING_STATUSES = [
  "pending",
  "confirmed",
  "cancelled",
  "completed",
  "no_show",
] as const
export type BookingStatus = (typeof BOOKING_STATUSES)[number]
export const ACTIVE_STATUSES = ["pending", "confirmed"] as const

export const STATUS_LABELS: Record<BookingStatus, string> = {
  pending: "Waiting for approval",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  completed: "Completed",
  no_show: "No-show",
}
export const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
]
export const SLOT_STEPS = [5, 10, 15, 20, 30, 60] as const

/** Online bookings allowed per IP per org per hour. */
export const ONLINE_RATE_LIMIT = { max: 10, windowMs: 60 * 60 * 1000 }

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

const int = (min: number, max: number, message = `Between ${min} and ${max}`) =>
  z.coerce.number("Enter a number").int("Whole numbers only").min(min, message).max(max, message)

const checkbox = z
  .union([z.boolean(), z.string()])
  .nullish()
  .transform((v) => v === true || v === "on" || v === "true")

const email = text(254).refine(
  (v) => v === null || z.email().safeParse(v).success,
  "Enter a valid email",
)
const phone = text(40).refine(
  (v) => v === null || /^[+()\d\s./-]{3,}$/.test(v),
  "Use digits, spaces and + ( ) - only",
)

export const settingsInputSchema = z.object({
  timeZone: z.string().trim().refine(isValidTimeZone, "Choose a valid time zone"),
  slotMinutes: z.coerce
    .number()
    .refine((n) => (SLOT_STEPS as readonly number[]).includes(n), "Choose a slot length"),
  minNoticeMinutes: int(0, 60 * 24 * 30),
  maxDaysAhead: int(1, 365),
  cancelNoticeMinutes: int(0, 60 * 24 * 30),
  requireApproval: checkbox,
  publicEnabled: checkbox,
})
export type SettingsInput = z.input<typeof settingsInputSchema>

export const serviceInputSchema = z.object({
  name: required(120, "Give the service a name"),
  description: text(1000),
  durationMinutes: int(5, 1440, "Between 5 minutes and 24 hours"),
  bufferMinutes: int(0, 240, "Between 0 and 240 minutes"),
  price: z
    .union([z.string(), z.number()])
    .nullish()
    .transform((v, ctx) => {
      const n = parseMoney(v === null || v === undefined || v === "" ? "0" : String(v))
      if (n === null) {
        ctx.addIssue({ code: "custom", message: "Enter an amount like 40 or 39.50" })
        return z.NEVER
      }
      return n
    }),
  currency: z.enum(CURRENCIES, "Choose a currency"),
  resourceIds: z.array(z.uuid()).max(200).default([]),
})
export type ServiceInput = z.input<typeof serviceInputSchema>

export const resourceInputSchema = z.object({
  name: required(80, "Give it a name"),
  userId: z
    .string()
    .nullish()
    .transform((v) => v?.trim() || null)
    .refine((v) => v === null || z.uuid().safeParse(v).success, "Choose someone from the list"),
})
export type ResourceInput = z.input<typeof resourceInputSchema>

/** A week of opening hours as "HH:MM" ranges. Ranges on the same day can't overlap. */
export const hoursInputSchema = z
  .array(
    z.object({
      weekday: z.coerce.number().int().min(0).max(6),
      start: z.string(),
      end: z.string(),
    }),
  )
  .max(50)
  .transform((rows, ctx) => {
    const out: { weekday: number; startMinute: number; endMinute: number }[] = []
    rows.forEach((r, i) => {
      const s = parseClock(r.start)
      const e = parseClock(r.end)
      if (s === null || e === null)
        ctx.addIssue({ code: "custom", path: [i], message: "Use times like 09:00" })
      else if (s >= e) ctx.addIssue({ code: "custom", path: [i], message: "End after start" })
      else out.push({ weekday: r.weekday, startMinute: s, endMinute: e })
    })
    for (const a of out)
      for (const b of out)
        if (
          a !== b &&
          a.weekday === b.weekday &&
          a.startMinute < b.endMinute &&
          b.startMinute < a.endMinute
        ) {
          ctx.addIssue({
            code: "custom",
            path: [rows.findIndex((r) => r.weekday === a.weekday)],
            message: "Times overlap on the same day",
          })
          return z.NEVER
        }
    return out
  })
export type HoursInput = z.input<typeof hoursInputSchema>

const localDateTime = (message: string) =>
  z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, message)

export const timeOffInputSchema = z
  .object({
    resourceId: z.uuid("Choose who"),
    /** "2026-11-20T09:00" in the business's time zone. */
    startsAt: localDateTime("Pick a start"),
    endsAt: localDateTime("Pick an end"),
    reason: text(200),
  })
  .refine((v) => v.endsAt > v.startsAt, { path: ["endsAt"], message: "End after start" })
export type TimeOffInput = z.input<typeof timeOffInputSchema>

const instant = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), "Choose a time")
  .transform((s) => new Date(s))

const person = {
  customerName: required(120, "Enter a name"),
  customerEmail: email,
  customerPhone: phone,
  notes: text(1000),
}

export const staffBookingSchema = z.object({
  serviceId: z.uuid("Choose a service"),
  resourceId: z.uuid("Choose who"),
  startsAt: instant,
  customerId: z
    .string()
    .nullish()
    .transform((v) => v?.trim() || null)
    .refine((v) => v === null || z.uuid().safeParse(v).success, "Choose a customer from the list"),
  ...person,
})
export type StaffBookingInput = z.input<typeof staffBookingSchema>

export const onlineBookingSchema = z.object({
  serviceId: z.uuid("Choose a service"),
  /** A resource id, or "any" for whoever is free. */
  resourceId: z.union([z.literal("any"), z.uuid()]),
  startsAt: instant,
  ...person,
  customerEmail: required(254, "Enter your email").pipe(z.email("Enter a valid email")),
})
export type OnlineBookingInput = z.input<typeof onlineBookingSchema>

export const cancelReasonSchema = text(500)

export function fieldErrors(error: z.ZodError) {
  const out: Record<string, string> = {}
  for (const i of error.issues) out[i.path.join(".") || "_form"] ??= i.message
  return out
}
