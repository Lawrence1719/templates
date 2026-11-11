/**
 * Membership constants, period math and validation. Safe to import in the browser.
 */
import { addDays, CURRENCIES, formatMoney, isDay, today } from "@templates/invoicing/definitions"
import { z } from "zod"

export { addDays, CURRENCIES, formatMoney, isDay, today }

export const PERIOD_UNITS = ["day", "week", "month", "year"] as const
export type PeriodUnit = (typeof PERIOD_UNITS)[number]

export const PAID_VIA = ["cash", "card", "other", "invoice", "free"] as const
export type PaidVia = (typeof PAID_VIA)[number]
export const PAID_VIA_LABELS: Record<PaidVia, string> = {
  cash: "Cash",
  card: "Card",
  other: "Other",
  invoice: "Send an invoice",
  free: "Free",
}

export const MEMBERSHIP_STATUSES = ["active", "paused", "cancelled"] as const
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number]

/** What staff see: status plus whether the paid period has run out. */
export type MembershipState =
  | "active"
  | "expiring"
  | "expired"
  | "paused"
  | "cancelled"
  | "upcoming"
export const STATE_LABELS: Record<MembershipState, string> = {
  active: "Active",
  expiring: "Ending soon",
  expired: "Expired",
  paused: "Paused",
  cancelled: "Cancelled",
  upcoming: "Starts soon",
}
export const MEMBERSHIP_FILTER_STATES = [
  "active",
  "expiring",
  "expired",
  "paused",
  "cancelled",
] as const

export function membershipState(
  m: { status: MembershipStatus; periodStart: string; periodEnd: string },
  todayStr: string,
  soonDays = 7,
): MembershipState {
  if (m.status === "cancelled") return "cancelled"
  if (m.status === "paused") return "paused"
  if (m.periodStart > todayStr) return "upcoming"
  if (m.periodEnd < todayStr) return "expired"
  if (m.periodEnd <= addDays(todayStr, soonDays)) return "expiring"
  return "active"
}

/** Calendar months, keeping the day where it exists: Jan 31 + 1 month = Feb 28. */
function addMonths(day: string, n: number) {
  const y = Number(day.slice(0, 4))
  const m = Number(day.slice(5, 7)) - 1 + n
  const d = Number(day.slice(8, 10))
  const year = y + Math.floor(m / 12)
  const month = ((m % 12) + 12) % 12
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month, Math.min(d, last))).toISOString().slice(0, 10)
}

/** The last day of a period that starts on `start`. 1 month from Jan 15 runs to Feb 14. */
export function periodEndFor(start: string, plan: { periodUnit: PeriodUnit; periodCount: number }) {
  const n = plan.periodCount
  const next =
    plan.periodUnit === "day"
      ? addDays(start, n)
      : plan.periodUnit === "week"
        ? addDays(start, n * 7)
        : addMonths(start, plan.periodUnit === "month" ? n : n * 12)
  return addDays(next, -1)
}

/** When the next period starts: the day after this one ends, or today if it lapsed. */
export function nextPeriodStart(periodEnd: string, todayStr: string) {
  const after = addDays(periodEnd, 1)
  return after < todayStr ? todayStr : after
}

export function formatPeriod(p: { periodUnit: PeriodUnit; periodCount: number }) {
  const unit = p.periodCount === 1 ? p.periodUnit : `${p.periodUnit}s`
  return p.periodCount === 1 ? `per ${unit}` : `per ${p.periodCount} ${unit}`
}

export const formatVisits = (limit: number | null) =>
  limit === null ? "Unlimited visits" : `${limit} ${limit === 1 ? "visit" : "visits"}`

export const daysBetween = (a: string, b: string) =>
  Math.round(
    (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000,
  )

export function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz })
    return tz.length > 0 && tz.length <= 64
  } catch {
    return false
  }
}

/** Card codes are typed or scanned at the desk: tolerate spaces, dashes and case. */
export const normalizeCardCode = (code: string) => code.replace(/[\s-]/g, "").toUpperCase()

/** "K7Q2M9…" → "K7Q2-M9X4-…" for printing. */
export const formatCardCode = (token: string) => token.match(/.{1,4}/g)?.join("-") ?? token

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

const requiredDay = (message: string) => z.string(message).trim().refine(isDay, message)

const money = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v, ctx) => {
    const s = v === null || v === undefined ? "" : String(v).replace(/[\s,]/g, "")
    const m = /^(\d{1,11})(?:\.(\d{1,2}))?$/.exec(s || "x")
    if (!m) {
      ctx.addIssue({ code: "custom", message: "Enter a price like 49 or 1200.50" })
      return z.NEVER
    }
    return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"))
  })

export const planInputSchema = z.object({
  name: required(80, "Name the plan"),
  description: text(500),
  price: money,
  currency: z.enum(CURRENCIES, "Choose a currency"),
  periodUnit: z.enum(PERIOD_UNITS, "Choose how long a period is"),
  periodCount: z.coerce
    .number("Enter a number like 1")
    .int("Whole numbers only")
    .min(1, "At least 1")
    .max(1000, "At most 1000"),
  /** Blank means unlimited. */
  visitLimit: z
    .union([z.string(), z.number()])
    .nullish()
    .transform((v, ctx) => {
      const s = v === null || v === undefined ? "" : String(v).trim()
      if (!s) return null
      const n = Number(s)
      if (!Number.isInteger(n) || n < 1 || n > 10_000) {
        ctx.addIssue({
          code: "custom",
          message: "Enter visits like 10, or leave blank for unlimited",
        })
        return z.NEVER
      }
      return n
    }),
})
export type PlanInput = z.input<typeof planInputSchema>

export const settingsInputSchema = z.object({
  timeZone: z.string().trim().refine(isValidTimeZone, "Choose a valid time zone"),
  checkInCooldownMinutes: z.coerce
    .number("Enter minutes like 60")
    .int("Whole minutes only")
    .min(0, "0 or more")
    .max(1440, "At most 1440 (a day)"),
  reminderDays: z.coerce
    .number("Enter days like 7")
    .int("Whole days only")
    .min(0, "0 or more")
    .max(90, "At most 90"),
})
export type SettingsInput = z.input<typeof settingsInputSchema>

export const startInputSchema = z.object({
  customerId: z.uuid("Choose a customer"),
  planId: z.uuid("Choose a plan"),
  startDay: requiredDay("Pick the first day"),
  paidVia: z.enum(PAID_VIA, "Choose how they paid"),
  autoRenew: z
    .boolean()
    .nullish()
    .transform((v) => !!v),
})
export type StartInput = z.input<typeof startInputSchema>

export const renewInputSchema = z.object({
  paidVia: z.enum(PAID_VIA, "Choose how they paid"),
  /** The period end the screen showed, so a double click can't renew twice. */
  expectedPeriodEnd: requiredDay("Reload and try again"),
})
export type RenewInput = z.input<typeof renewInputSchema>

export const reasonSchema = required(300, "Say why")

export const membershipFilterSchema = z.object({
  state: z.enum(MEMBERSHIP_FILTER_STATES).optional().catch(undefined),
  plan: z.uuid().optional().catch(undefined),
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .catch(undefined)
    .transform((v) => v || undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
})
export type MembershipFilter = z.input<typeof membershipFilterSchema>

export function fieldErrors(error: z.ZodError) {
  const out: Record<string, string> = {}
  for (const i of error.issues) out[i.path.join(".") || "_form"] ??= i.message
  return out
}
