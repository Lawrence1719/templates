/**
 * HR constants, day math and validation. Safe to import in the browser.
 */
import { addDays, CURRENCIES, formatMoney, isDay, today } from "@templates/invoicing/definitions"
import { z } from "zod"

export { addDays, CURRENCIES, formatMoney, isDay, today }

export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "intern"] as const
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number]
export const EMPLOYMENT_LABELS: Record<EmploymentType, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contractor",
  intern: "Intern",
}

export const EMPLOYEE_STATUSES = ["active", "left"] as const
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number]

export const PAY_TYPES = ["hourly", "salary"] as const
export type PayType = (typeof PAY_TYPES)[number]
export const PAY_LABELS: Record<PayType, string> = { hourly: "per hour", salary: "per year" }

export const LEAVE_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const
export type LeaveStatus = (typeof LEAVE_STATUSES)[number]
export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  pending: "Waiting for approval",
  approved: "Approved",
  rejected: "Declined",
  cancelled: "Cancelled",
}

export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const
export const WEEKDAY_LABELS: Record<number, string> = {
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
  7: "Sun",
}

// ---------- Days ----------

/** ISO weekday of a YYYY-MM-DD day: 1 = Monday … 7 = Sunday. */
export function isoWeekday(day: string) {
  const d = new Date(`${day}T00:00:00Z`).getUTCDay()
  return d === 0 ? 7 : d
}

/** Monday of the week a day falls in. */
export const weekStart = (day: string) => addDays(day, 1 - isoWeekday(day))

export function daysBetween(a: string, b: string) {
  return Math.round(
    (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000,
  )
}

/**
 * Working days a leave request takes, in half days: only the org's work days,
 * never holidays. A half-day request is one half day.
 */
export function countLeave(
  startDay: string,
  endDay: string,
  opts: { workDays: readonly number[]; holidays: ReadonlySet<string>; halfDay?: boolean },
) {
  let n = 0
  for (let d = startDay; d <= endDay; d = addDays(d, 1))
    if (opts.workDays.includes(isoWeekday(d)) && !opts.holidays.has(d)) n += 2
  if (opts.halfDay) return n > 0 ? 1 : 0
  return n
}

/** The leave year a day falls in, named by the calendar year it starts in. */
export function leaveYearOf(day: string, startMonth: number) {
  const y = Number(day.slice(0, 4))
  const m = Number(day.slice(5, 7))
  return m >= startMonth ? y : y - 1
}

export function leaveYearRange(year: number, startMonth: number) {
  const start = `${year}-${String(startMonth).padStart(2, "0")}-01`
  const nextStart = `${year + 1}-${String(startMonth).padStart(2, "0")}-01`
  return { start, end: addDays(nextStart, -1) }
}

export const leaveYearLabel = (year: number, startMonth: number) =>
  startMonth === 1 ? String(year) : `${year}–${String(year + 1).slice(2)}`

/** 5 → "2.5 days", 2 → "1 day". */
export function formatDays(halfDays: number) {
  const days = halfDays / 2
  const n = days.toLocaleString("en", { maximumFractionDigits: 1 })
  return `${n} ${Math.abs(days) === 1 ? "day" : "days"}`
}

/** "12" or "7.5" days → half days; only whole or half days. */
export function parseDays(input: string, opts: { signed?: boolean } = {}): number | null {
  const m = /^(-)?(\d{1,3})(?:\.(\d))?$/.exec(input.trim())
  if (!m) return null
  if (m[1] && !opts.signed) return null
  if (m[3] && m[3] !== "0" && m[3] !== "5") return null
  const half = Number(m[2]) * 2 + (m[3] === "5" ? 1 : 0)
  return m[1] ? -half : half
}

export function formatHours(minutes: number) {
  const h = Math.floor(Math.abs(minutes) / 60)
  const m = Math.abs(minutes) % 60
  return `${minutes < 0 ? "−" : ""}${h}h ${String(m).padStart(2, "0")}m`
}

export function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz })
    return tz.length > 0 && tz.length <= 64
  } catch {
    return false
  }
}

/** "2026-11-11" + "09:30" in a zone → the UTC instant, or null for a time skipped by DST. */
export function zonedTime(day: string, clock: string, timeZone: string): Date | null {
  const m = /^(\d{2}):(\d{2})$/.exec(clock)
  if (!m || !isDay(day)) return null
  const [h, min] = [Number(m[1]), Number(m[2])]
  if (h > 23 || min > 59) return null
  const wall = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), h, min)
  const parts = (t: number) => {
    const p: Record<string, string> = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
        .formatToParts(new Date(t))
        .map((x) => [x.type, x.value]),
    )
    return Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour),
      Number(p.minute),
    )
  }
  // Two passes handle offsets that change around the moment itself.
  let guess = wall - (parts(wall) - wall)
  guess = wall - (parts(guess) - guess)
  return parts(guess) === wall ? new Date(guess) : null
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

const day = (message = "Pick a date") =>
  z
    .string()
    .nullish()
    .transform((v) => v?.trim() || null)
    .refine((v) => v === null || isDay(v), message)

const requiredDay = (message: string) => z.string(message).trim().refine(isDay, message)

const email = text(200).refine(
  (v) => v === null || z.email().safeParse(v).success,
  "Enter an email like name@company.com",
)

const money = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v, ctx) => {
    const s = v === null || v === undefined ? "" : String(v).replace(/[\s,]/g, "")
    if (!s) return null
    const m = /^(\d{1,11})(?:\.(\d{1,2}))?$/.exec(s)
    if (!m) {
      ctx.addIssue({ code: "custom", message: "Enter an amount like 25 or 52000" })
      return z.NEVER
    }
    return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"))
  })

const halfDays = (opts: { signed?: boolean; message: string }) =>
  z
    .union([z.string(), z.number()])
    .nullish()
    .transform((v, ctx) => {
      const n = parseDays(v === null || v === undefined ? "" : String(v), opts)
      if (n === null) {
        ctx.addIssue({ code: "custom", message: opts.message })
        return z.NEVER
      }
      return n
    })

export const employeeInputSchema = z
  .object({
    name: required(120, "Enter their name"),
    userId: optionalId("Choose a member from the list"),
    workEmail: email,
    phone: text(40),
    jobTitle: text(120),
    departmentId: optionalId("Choose a department from the list"),
    managerId: optionalId("Choose a manager from the list"),
    employmentType: z.enum(EMPLOYMENT_TYPES, "Choose a type"),
    startDate: requiredDay("Pick their start date"),
    endDate: day(),
    status: z
      .enum(EMPLOYEE_STATUSES)
      .nullish()
      .transform((v) => v ?? "active"),
    payType: z
      .enum(PAY_TYPES)
      .nullish()
      .or(z.literal(""))
      .transform((v) => v || null),
    payRate: money,
    payCurrency: z
      .enum(CURRENCIES)
      .nullish()
      .or(z.literal(""))
      .transform((v) => v || null),
    birthDate: day(),
    homeAddress: text(500),
    emergencyContactName: text(120),
    emergencyContactPhone: text(40),
    privateNotes: text(2000),
  })
  .refine((v) => !v.endDate || !v.startDate || v.endDate >= v.startDate, {
    path: ["endDate"],
    message: "Can't be before the start date",
    when: ({ value }) => {
      const v = value as { startDate?: unknown; endDate?: unknown }
      return typeof v.startDate === "string" && typeof v.endDate === "string" && v.endDate !== ""
    },
  })
  .refine((v) => v.payRate === null || (v.payType && v.payCurrency), {
    path: ["payType"],
    message: "Choose how and in what currency they're paid",
    when: ({ value }) => (value as { payRate?: unknown }).payRate !== undefined,
  })
export type EmployeeInput = z.input<typeof employeeInputSchema>

/** The fields only `hr: manage` sees and edits. */
export const PRIVATE_FIELDS = [
  "payType",
  "payRateCents",
  "payCurrency",
  "birthDate",
  "homeAddress",
  "emergencyContactName",
  "emergencyContactPhone",
  "privateNotes",
] as const

export const settingsInputSchema = z.object({
  timeZone: z.string().trim().refine(isValidTimeZone, "Choose a valid time zone"),
  workDays: z
    .array(z.coerce.number().int().min(1).max(7))
    .min(1, "Pick at least one work day")
    .transform((v) => [...new Set(v)].sort()),
  leaveYearStartMonth: z.coerce.number().int().min(1, "Pick a month").max(12, "Pick a month"),
  weeklyHours: z.coerce
    .number("Enter hours like 40")
    .int("Whole hours only")
    .min(1, "At least 1 hour")
    .max(168, "At most 168 hours"),
})
export type SettingsInput = z.input<typeof settingsInputSchema>

export const departmentInputSchema = z.object({ name: required(80, "Name the department") })
export type DepartmentInput = z.input<typeof departmentInputSchema>

export const leaveTypeInputSchema = z.object({
  name: required(60, "Name the leave type"),
  /** Blank means not tracked (no allowance). */
  allowance: z
    .union([z.string(), z.number()])
    .nullish()
    .transform((v, ctx) => {
      const s = v === null || v === undefined ? "" : String(v).trim()
      if (!s) return null
      const n = parseDays(s)
      if (n === null || n > 730) {
        ctx.addIssue({ code: "custom", message: "Enter days like 15 or 7.5, or leave blank" })
        return z.NEVER
      }
      return n
    }),
  paid: z
    .boolean()
    .nullish()
    .transform((v) => v !== false),
})
export type LeaveTypeInput = z.input<typeof leaveTypeInputSchema>

export const holidayInputSchema = z.object({
  day: requiredDay("Pick the date"),
  name: required(80, "Name the holiday"),
})
export type HolidayInput = z.input<typeof holidayInputSchema>

export const leaveRequestSchema = z
  .object({
    leaveTypeId: z.uuid("Choose the kind of leave"),
    startDay: requiredDay("Pick the first day"),
    endDay: requiredDay("Pick the last day"),
    halfDay: z
      .boolean()
      .nullish()
      .transform((v) => !!v),
    reason: text(500),
  })
  .refine((v) => v.endDay >= v.startDay, {
    path: ["endDay"],
    message: "Can't be before the first day",
    when: ({ value }) => {
      const v = value as { startDay?: unknown; endDay?: unknown }
      return typeof v.startDay === "string" && typeof v.endDay === "string"
    },
  })
  .refine((v) => !v.halfDay || v.startDay === v.endDay, {
    path: ["halfDay"],
    message: "Half days are for single-day requests",
    when: ({ value }) => {
      const v = value as { startDay?: unknown; endDay?: unknown }
      return typeof v.startDay === "string" && typeof v.endDay === "string"
    },
  })
  .refine((v) => daysBetween(v.startDay, v.endDay) <= 366, {
    path: ["endDay"],
    message: "Keep a request under a year",
    when: ({ value }) => {
      const v = value as { startDay?: unknown; endDay?: unknown }
      return typeof v.startDay === "string" && typeof v.endDay === "string"
    },
  })
export type LeaveRequestInput = z.input<typeof leaveRequestSchema>

export const adjustmentInputSchema = z.object({
  leaveTypeId: z.uuid("Choose the kind of leave"),
  year: z.coerce.number().int().min(2000).max(2100),
  days: halfDays({ signed: true, message: "Enter days like 2, 0.5 or -1" }).refine(
    (n) => n !== 0,
    "Enter days other than 0",
  ),
  reason: required(200, "Say why"),
})
export type AdjustmentInput = z.input<typeof adjustmentInputSchema>

/** A manual time entry: a day, start and end clock times in the org's zone. */
export const timeEntryInputSchema = z
  .object({
    day: requiredDay("Pick the date"),
    start: z.string().regex(/^\d{2}:\d{2}$/, "Enter a time like 09:00"),
    /** Blank keeps it open (still working). */
    end: z
      .string()
      .nullish()
      .transform((v) => v?.trim() || null)
      .refine((v) => v === null || /^\d{2}:\d{2}$/.test(v), "Enter a time like 17:30"),
    /** Ends after midnight. */
    overnight: z
      .boolean()
      .nullish()
      .transform((v) => !!v),
    note: text(300),
  })
  .refine((v) => !v.end || v.overnight || v.end > v.start, {
    path: ["end"],
    message: "Must be after the start (tick 'ends next day' for overnight shifts)",
    when: ({ value }) => {
      const v = value as { start?: unknown; end?: unknown }
      return typeof v.start === "string" && typeof v.end === "string"
    },
  })
export type TimeEntryInput = z.input<typeof timeEntryInputSchema>

export const decisionSchema = z.object({
  approve: z.boolean(),
  note: text(500),
})

export const employeeFilterSchema = z.object({
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .catch(undefined)
    .transform((v) => v || undefined),
  department: z.uuid().optional().catch(undefined),
  status: z.enum(EMPLOYEE_STATUSES).optional().catch(undefined),
})
export type EmployeeFilter = z.input<typeof employeeFilterSchema>

export function fieldErrors(error: z.ZodError) {
  const out: Record<string, string> = {}
  for (const i of error.issues) out[i.path.join(".") || "_form"] ??= i.message
  return out
}
