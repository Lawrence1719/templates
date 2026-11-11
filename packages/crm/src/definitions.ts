/**
 * CRM constants and validation. Safe to import in the browser:
 * forms use the same schemas the server enforces.
 */
import { z } from "zod"

export const CUSTOMER_KINDS = ["company", "person"] as const
export const CUSTOMER_STATUSES = ["lead", "active", "inactive"] as const
export const DEAL_STAGES = ["new", "qualified", "proposal", "won", "lost"] as const
export const OPEN_STAGES = ["new", "qualified", "proposal"] as const
/** Kinds people can log. `system` entries are written by the module only. */
export const ACTIVITY_KINDS = ["note", "call", "email", "meeting"] as const
export const CURRENCIES = ["USD", "EUR", "GBP", "AUD", "CAD", "SGD", "PHP", "JPY"] as const

export type CustomerKind = (typeof CUSTOMER_KINDS)[number]
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number]
export type DealStage = (typeof DEAL_STAGES)[number]
export type ActivityKind = (typeof ACTIVITY_KINDS)[number]

export const STAGE_LABELS: Record<DealStage, string> = {
  new: "New",
  qualified: "Qualified",
  proposal: "Proposal",
  won: "Won",
  lost: "Lost",
}

export const STATUS_LABELS: Record<CustomerStatus, string> = {
  lead: "Lead",
  active: "Active",
  inactive: "Inactive",
}

export const ACTIVITY_LABELS: Record<ActivityKind | "system", string> = {
  note: "Note",
  call: "Call",
  email: "Email",
  meeting: "Meeting",
  system: "Update",
}

export const MAX_TAGS = 10

// ---------- Field helpers ----------

/** Trimmed optional text: "" and missing become null. */
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

const email = optional(254).refine(
  (v) => v === null || z.email().safeParse(v).success,
  "Enter a valid email",
)

const phone = optional(40).refine(
  (v) => v === null || /^[+()\d\s./-]{3,}$/.test(v),
  "Use digits, spaces and + ( ) - only",
)

/**
 * Only http(s) links are stored, so a saved website can never become a
 * `javascript:` link. A bare domain gets https:// added.
 */
const website = optional(300)
  .transform((v) => (v && !/^[a-z][a-z\d+.-]*:/i.test(v) ? `https://${v}` : v))
  .refine((v) => {
    if (v === null) return true
    try {
      const u = new URL(v)
      return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".")
    } catch {
      return false
    }
  }, "Enter a website like example.com")

const userId = z
  .string()
  .nullish()
  .transform((v) => v?.trim() || null)
  .refine((v) => v === null || z.uuid().safeParse(v).success, "Choose someone from the list")

/** Accepts "vip, Wholesale" or ["vip", "wholesale"]; stores lowercase, unique labels. */
export const tagsSchema = z
  .union([z.string(), z.array(z.string())])
  .nullish()
  .transform((v) => {
    const list = Array.isArray(v) ? v : (v ?? "").split(",")
    return [
      ...new Set(list.map((t) => t.trim().toLowerCase().replace(/\s+/g, " ")).filter(Boolean)),
    ]
  })
  .refine((t) => t.length <= MAX_TAGS, `Use at most ${MAX_TAGS} tags`)
  .refine(
    (t) => t.every((x) => x.length <= 30 && /^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u.test(x)),
    "Tags are short words: letters, numbers, spaces, - and _",
  )

/** "1,250.50" → 125050. Parsed from the string so no float rounding is involved. */
export function parseMoney(input: string): number | null {
  const s = input.replace(/[\s,]/g, "")
  const m = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(s)
  if (!m) return null
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"))
}

export function formatMoney(cents: number, currency: string) {
  const zeroDecimal = currency === "JPY"
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    maximumFractionDigits: zeroDecimal ? 0 : 2,
  }).format(cents / 100)
}

const money = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => (v === null || v === undefined || v === "" ? "0" : String(v)))
  .transform((v, ctx) => {
    const cents = parseMoney(v)
    if (cents === null) {
      ctx.addIssue({ code: "custom", message: "Enter an amount like 1250 or 1,250.50" })
      return z.NEVER
    }
    return cents
  })

const day = z
  .string()
  .nullish()
  .transform((v) => v?.trim() || null)
  .refine(
    (v) => v === null || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))),
    "Pick a date",
  )

const checkbox = z
  .union([z.boolean(), z.string()])
  .nullish()
  .transform((v) => v === true || v === "on" || v === "true")

// ---------- Inputs ----------

export const customerInputSchema = z.object({
  kind: z.enum(CUSTOMER_KINDS, "Choose company or person"),
  name: required(120, "Enter a name"),
  email,
  phone,
  website,
  address: optional(500),
  status: z.enum(CUSTOMER_STATUSES, "Choose a status"),
  ownerId: userId,
  tags: tagsSchema,
})
export type CustomerInput = z.input<typeof customerInputSchema>

export const contactInputSchema = z.object({
  name: required(120, "Enter a name"),
  title: optional(80),
  email,
  phone,
  isPrimary: checkbox,
})
export type ContactInput = z.input<typeof contactInputSchema>

export const dealInputSchema = z.object({
  title: required(120, "Give the deal a name"),
  value: money,
  currency: z.enum(CURRENCIES, "Choose a currency"),
  stage: z.enum(DEAL_STAGES, "Choose a stage"),
  ownerId: userId,
  expectedCloseOn: day,
})
export type DealInput = z.input<typeof dealInputSchema>

export const activityInputSchema = z.object({
  kind: z.enum(ACTIVITY_KINDS, "Choose what happened"),
  body: required(5000, "Write what happened"),
  /** From a datetime-local input. Defaults to now. Up to a year ahead, for planned meetings. */
  occurredAt: z
    .string()
    .nullish()
    .transform((v) => (v?.trim() ? new Date(v) : new Date()))
    .refine(
      (d) =>
        !Number.isNaN(d.getTime()) &&
        d.getFullYear() >= 2000 &&
        d.getTime() < Date.now() + 366 * 86_400_000,
      "Pick a valid date and time",
    ),
})
export type ActivityInput = z.input<typeof activityInputSchema>

export const customerFilterSchema = z.object({
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .catch(undefined)
    .transform((v) => v || undefined),
  status: z.enum(CUSTOMER_STATUSES).optional().catch(undefined),
  /** "me", "none" or a user id. */
  owner: z
    .union([z.literal("me"), z.literal("none"), z.uuid()])
    .optional()
    .catch(undefined),
  tag: z.string().trim().toLowerCase().max(30).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
})
export type CustomerFilter = z.input<typeof customerFilterSchema>

/** Zod issues as { "field.path": "first message" } for showing next to inputs. */
export function fieldErrors(error: z.ZodError) {
  const out: Record<string, string> = {}
  for (const i of error.issues) out[i.path.join(".") || "_form"] ??= i.message
  return out
}
