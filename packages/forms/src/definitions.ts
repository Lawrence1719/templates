/**
 * Form field definitions and answer validation.
 * Safe for the browser: the same rules give instant feedback client-side
 * and are enforced again on the server before anything is saved.
 */
import { z } from "zod"

export const FIELD_TYPES = {
  short_text: { label: "Short text", hasOptions: false },
  long_text: { label: "Paragraph", hasOptions: false },
  email: { label: "Email", hasOptions: false },
  phone: { label: "Phone", hasOptions: false },
  number: { label: "Number", hasOptions: false },
  date: { label: "Date", hasOptions: false },
  select: { label: "Dropdown", hasOptions: true },
  multi_select: { label: "Checkboxes", hasOptions: true },
  checkbox: { label: "Yes / consent", hasOptions: false },
} as const
export type FieldType = keyof typeof FIELD_TYPES

const text = (max: number) => z.string().trim().max(max)

export const fieldSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]{1,40}$/, "Field ids are lowercase letters, digits and _"),
  type: z.enum(Object.keys(FIELD_TYPES) as [FieldType, ...FieldType[]]),
  label: text(200).min(1, "Every field needs a label"),
  help: text(500).optional(),
  required: z.boolean().default(false),
  placeholder: text(200).optional(),
  options: z.array(text(200).min(1)).max(50).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
})
export type Field = z.infer<typeof fieldSchema>

export const MAX_FIELDS = 50

export const fieldsSchema = z
  .array(fieldSchema)
  .max(MAX_FIELDS, `A form can have up to ${MAX_FIELDS} fields`)
  .superRefine((fields, ctx) => {
    const seen = new Set<string>()
    fields.forEach((f, i) => {
      if (seen.has(f.id))
        ctx.addIssue({ code: "custom", path: [i, "id"], message: `Duplicate field id "${f.id}"` })
      seen.add(f.id)
      if (FIELD_TYPES[f.type].hasOptions && !f.options?.length)
        ctx.addIssue({
          code: "custom",
          path: [i, "options"],
          message: `"${f.label}" needs at least one option`,
        })
      if (f.min !== undefined && f.max !== undefined && f.min > f.max)
        ctx.addIssue({
          code: "custom",
          path: [i, "min"],
          message: `"${f.label}": minimum is above maximum`,
        })
    })
  })

export const formSettingsSchema = z.object({
  title: text(200).min(1, "Give the form a title"),
  description: text(2000).optional(),
  visibility: z.enum(["public", "members"]),
  confirmation: text(1000).optional(),
  fields: fieldsSchema,
})
export type FormSettings = z.infer<typeof formSettingsSchema>

/** A zod schema for one submission of a form with these fields. */
export function answerSchema(fields: Field[]) {
  const shape: Record<string, z.ZodType> = {}
  for (const f of fields) {
    let s: z.ZodType
    switch (f.type) {
      case "short_text":
        s = text(f.max ?? 500)
        break
      case "long_text":
        s = text(f.max ?? 5000)
        break
      case "email":
        s = z.email("Enter a valid email").max(254)
        break
      case "phone":
        s = z
          .string()
          .trim()
          .regex(/^\+?[0-9 ()-]{6,20}$/, "Enter a valid phone number")
        break
      case "number": {
        let n = z.coerce
          .number({ error: "Enter a number" })
          .refine(Number.isFinite, "Enter a number")
        if (f.min !== undefined)
          n = n.refine((v) => v >= (f.min as number), `Must be at least ${f.min}`)
        if (f.max !== undefined)
          n = n.refine((v) => v <= (f.max as number), `Must be at most ${f.max}`)
        s = n
        break
      }
      case "date":
        s = z.iso.date("Enter a valid date")
        break
      case "select":
        s = z.enum((f.options ?? [""]) as [string, ...string[]], {
          error: "Choose one of the options",
        })
        break
      case "multi_select":
        s = z
          .array(z.enum((f.options ?? [""]) as [string, ...string[]]))
          .max(f.options?.length ?? 0)
        break
      case "checkbox":
        s = z.boolean()
        break
    }
    shape[f.id] = f.required ? requiredOf(f, s) : optionalOf(s)
  }
  // .strict(): unknown keys are rejected, so nothing extra can be stored.
  return z.object(shape).strict()
}

const isEmpty = (v: unknown) =>
  v === undefined ||
  v === null ||
  (typeof v === "string" && v.trim() === "") ||
  (Array.isArray(v) && v.length === 0)

function requiredOf(f: Field, s: z.ZodType) {
  const msg = f.type === "checkbox" ? "This box must be checked" : "This field is required"
  const present = z.any().refine((v) => v !== undefined, { message: msg })
  return z.preprocess(
    (v) => (isEmpty(v) || (f.type === "checkbox" && v === false) ? undefined : v),
    present.pipe(s),
  )
}

function optionalOf(s: z.ZodType) {
  return z.preprocess((v) => (isEmpty(v) ? undefined : v), s.optional())
}

/** Turns zod issues into { fieldId: message } for the UI. */
export function fieldErrors(error: z.ZodError) {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "_form")
    out[key] ??=
      issue.code === "unrecognized_keys" ? "Unexpected fields in submission" : issue.message
  }
  return out
}

/** Readable value for tables and CSV. */
export function displayAnswer(v: unknown) {
  if (v === undefined || v === null) return ""
  if (Array.isArray(v)) return v.join(", ")
  if (typeof v === "boolean") return v ? "Yes" : "No"
  return String(v)
}

/** A short, unique field id from a label, e.g. "Company name" → "company_name". */
export function fieldIdFrom(label: string, taken: Set<string>) {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 32) || "field"
  let id = base
  for (let i = 2; taken.has(id); i++) id = `${base}_${i}`
  return id
}
