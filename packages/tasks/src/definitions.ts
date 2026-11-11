/**
 * Task constants, validation and date helpers. Safe to import in the browser.
 */
import { z } from "zod"

export const TASK_STATUSES = ["todo", "in_progress", "done"] as const
export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const
export const TASK_RECURRENCES = ["none", "daily", "weekly", "monthly"] as const

export type TaskStatus = (typeof TASK_STATUSES)[number]
export type TaskPriority = (typeof TASK_PRIORITIES)[number]
export type TaskRecurrence = (typeof TASK_RECURRENCES)[number]

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
}
export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
}
export const RECURRENCE_LABELS: Record<TaskRecurrence, string> = {
  none: "Never",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
}
/** Higher sorts first. */
export const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 3, high: 2, normal: 1, low: 0 }

export const MAX_CHECKLIST_ITEMS = 50

// ---------- Dates (YYYY-MM-DD strings, no timezone surprises) ----------

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isDay(s: string) {
  const m = DAY_RE.exec(s)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.toISOString().slice(0, 10) === s
}

/** Today in the viewer's (or a given) timezone, as YYYY-MM-DD. */
export function today(timeZone?: string, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, dateStyle: "short" }).format(now)
}

export function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Adds months, keeping the day where possible: Jan 31 + 1 month = Feb 28 (or 29). */
export function addMonths(day: string, n: number) {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number]
  const target = new Date(Date.UTC(y, m - 1 + n, 1))
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate()
  target.setUTCDate(Math.min(d, lastDay))
  return target.toISOString().slice(0, 10)
}

/** The due date of the next occurrence of a recurring task. */
export function nextDue(
  from: string,
  recurrence: Exclude<TaskRecurrence, "none">,
  interval: number,
) {
  if (recurrence === "daily") return addDays(from, interval)
  if (recurrence === "weekly") return addDays(from, 7 * interval)
  return addMonths(from, interval)
}

export type DueBucket = "overdue" | "today" | "week" | "later" | "none"
export const BUCKET_LABELS: Record<DueBucket, string> = {
  overdue: "Overdue",
  today: "Today",
  week: "Next 7 days",
  later: "Later",
  none: "No due date",
}

export function dueBucket(dueOn: string | null, todayStr: string): DueBucket {
  if (!dueOn) return "none"
  if (dueOn < todayStr) return "overdue"
  if (dueOn === todayStr) return "today"
  if (dueOn <= addDays(todayStr, 7)) return "week"
  return "later"
}

// ---------- Inputs ----------

const optional = (max: number) =>
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

const id = (message: string) =>
  z
    .string()
    .nullish()
    .transform((v) => v?.trim() || null)
    .refine((v) => v === null || z.uuid().safeParse(v).success, message)

const day = z
  .string()
  .nullish()
  .transform((v) => v?.trim() || null)
  .refine((v) => v === null || isDay(v), "Pick a date")

export const taskInputSchema = z
  .object({
    title: required(200, "Give the task a title"),
    description: optional(10_000),
    status: z.enum(TASK_STATUSES, "Choose a status").default("todo"),
    priority: z.enum(TASK_PRIORITIES, "Choose a priority").default("normal"),
    assigneeId: id("Choose someone from the list"),
    projectId: id("Choose a project from the list"),
    dueOn: day,
    recurrence: z.enum(TASK_RECURRENCES, "Choose how it repeats").default("none"),
    recurrenceInterval: z.coerce
      .number("Enter a number")
      .int("Enter a whole number")
      .min(1, "At least 1")
      .max(365, "At most 365")
      .default(1),
  })
  .refine((t) => t.recurrence === "none" || t.dueOn !== null, {
    path: ["dueOn"],
    message: "Repeating tasks need a due date",
  })
export type TaskInput = z.input<typeof taskInputSchema>

export const projectInputSchema = z.object({
  name: required(120, "Give the project a name"),
  description: optional(2000),
})
export type ProjectInput = z.input<typeof projectInputSchema>

export const checklistTextSchema = required(300, "Write the item")
export const commentSchema = required(5000, "Write a comment")

export const taskFilterSchema = z.object({
  /** "me" (default view), "none", "all" or a user id. */
  assignee: z
    .union([z.literal("me"), z.literal("none"), z.literal("all"), z.uuid()])
    .optional()
    .catch(undefined),
  status: z
    .enum([...TASK_STATUSES, "open"])
    .optional()
    .catch(undefined),
  priority: z.enum(TASK_PRIORITIES).optional().catch(undefined),
  project: z.uuid().optional().catch(undefined),
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .catch(undefined)
    .transform((v) => v || undefined),
})
export type TaskFilter = z.input<typeof taskFilterSchema>

export function fieldErrors(error: z.ZodError) {
  const out: Record<string, string> = {}
  for (const i of error.issues) out[i.path.join(".") || "_form"] ??= i.message
  return out
}
