import "server-only"

import { createHmac, randomBytes } from "node:crypto"

import { audit } from "@templates/audit"
import { db } from "@templates/db"
import { type FormRecord, form, formSubmission, member, user } from "@templates/db/schema"
import { membersWithRole, notify } from "@templates/notifications"
import { and, count, desc, eq, gte } from "drizzle-orm"
import { z } from "zod"

import {
  answerSchema,
  displayAnswer,
  type Field,
  fieldErrors,
  fieldsSchema,
  formSettingsSchema,
} from "./definitions"

export type FormsContext = { orgId: string; user: { id: string; name: string; email: string } }

export class FormError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 429,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(message)
  }
}

/** Submissions allowed per IP, per form, per window. */
export const RATE_LIMIT = { max: 5, windowMs: 10 * 60 * 1000 }

const newSlug = () => randomBytes(9).toString("base64url") // 12 chars, ~72 bits
const isUuid = (s: string) => z.uuid().safeParse(s).success

/** Fields as stored, re-validated so bad JSON in the DB can't reach the renderer. */
export function fieldsOf(f: FormRecord): Field[] {
  const parsed = fieldsSchema.safeParse(f.fields)
  return parsed.success ? parsed.data : []
}

async function own(ctx: Pick<FormsContext, "orgId">, id: string) {
  if (!isUuid(id)) throw new FormError("Not found", 404)
  const [row] = await db
    .select()
    .from(form)
    .where(and(eq(form.id, id), eq(form.orgId, ctx.orgId)))
  if (!row) throw new FormError("Not found", 404)
  return row
}

// ---------- Managing forms (callers check `form: ["manage"]`) ----------

export async function createForm(ctx: FormsContext, title = "Untitled form") {
  const [row] = await db
    .insert(form)
    .values({
      orgId: ctx.orgId,
      title,
      slug: newSlug(),
      createdBy: ctx.user.id,
      fields: [
        { id: "name", type: "short_text", label: "Your name", required: true },
        { id: "email", type: "email", label: "Email", required: true },
      ],
    })
    .returning()
  if (!row) throw new Error("insert failed")
  await audit(ctx, "form.created", `Created form ${row.title}`, {
    target: { type: "form", id: row.id },
  })
  return row
}

export const getForm = own

export async function listForms(ctx: Pick<FormsContext, "orgId">) {
  return db
    .select({
      id: form.id,
      title: form.title,
      slug: form.slug,
      status: form.status,
      visibility: form.visibility,
      updatedAt: form.updatedAt,
      responses: count(formSubmission.id),
    })
    .from(form)
    .leftJoin(formSubmission, eq(formSubmission.formId, form.id))
    .where(eq(form.orgId, ctx.orgId))
    .groupBy(form.id)
    .orderBy(desc(form.updatedAt))
}

/** Saves title, description, visibility, confirmation and fields. Validated as a whole. */
export async function saveForm(ctx: FormsContext, id: string, input: unknown) {
  await own(ctx, id)
  const parsed = formSettingsSchema.safeParse(input)
  if (!parsed.success)
    throw new FormError("Please fix the highlighted problems.", 400, settingsErrors(parsed.error))
  const s = parsed.data
  const [row] = await db
    .update(form)
    .set({
      title: s.title,
      description: s.description || null,
      visibility: s.visibility,
      confirmation: s.confirmation || null,
      fields: s.fields,
    })
    .where(and(eq(form.id, id), eq(form.orgId, ctx.orgId)))
    .returning()
  return row
}

function settingsErrors(error: z.ZodError) {
  const out: Record<string, string> = {}
  for (const i of error.issues) out[i.path.join(".") || "_form"] ??= i.message
  return out
}

export async function setFormStatus(ctx: FormsContext, id: string, status: FormRecord["status"]) {
  const f = await own(ctx, id)
  if (status === "published" && fieldsOf(f).length === 0)
    throw new FormError("Add at least one field first.", 409)
  await db
    .update(form)
    .set({ status })
    .where(and(eq(form.id, id), eq(form.orgId, ctx.orgId)))
  await audit(
    ctx,
    `form.${status}`,
    `${status === "published" ? "Published" : status === "closed" ? "Closed" : "Unpublished"} form ${f.title}`,
    {
      target: { type: "form", id },
    },
  )
}

export async function deleteForm(ctx: FormsContext, id: string) {
  const f = await own(ctx, id)
  await db.delete(form).where(and(eq(form.id, id), eq(form.orgId, ctx.orgId)))
  await audit(ctx, "form.deleted", `Deleted form ${f.title}`, { target: { type: "form", id } })
}

// ---------- Filling in forms ----------

/**
 * A form by its share link, if it can be filled in.
 * Members-only forms also need a signed-in member of the form's org.
 */
export async function getFillableForm(slug: string, viewerId: string | null) {
  if (!/^[A-Za-z0-9_-]{8,32}$/.test(slug)) return { state: "missing" as const }
  const [f] = await db.select().from(form).where(eq(form.slug, slug))
  if (!f || f.status === "draft") return { state: "missing" as const }
  if (f.visibility === "members") {
    if (!viewerId) return { state: "sign-in" as const, form: f }
    if (!(await isMember(f.orgId, viewerId))) return { state: "missing" as const }
  }
  if (f.status === "closed") return { state: "closed" as const, form: f }
  return { state: "open" as const, form: f, fields: fieldsOf(f) }
}

async function isMember(orgId: string, userId: string) {
  const [m] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
  return !!m
}

const hashIp = (ip: string) =>
  createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "dev-secret")
    .update(ip)
    .digest("hex")
    .slice(0, 32)

/**
 * Validates and stores one submission.
 * `honeypot` is a hidden field real people leave empty; bots fill it in.
 */
export async function submitForm(input: {
  slug: string
  answers: unknown
  honeypot?: string
  ip: string | null
  viewerId: string | null
}) {
  const result = await getFillableForm(input.slug, input.viewerId)
  if (result.state === "missing") throw new FormError("This form doesn't exist.", 404)
  if (result.state === "sign-in") throw new FormError("Sign in to fill in this form.", 403)
  if (result.state === "closed")
    throw new FormError("This form is no longer accepting responses.", 409)
  const { form: f, fields } = result

  // Pretend success to bots so they don't adapt.
  if (input.honeypot) return { ok: true as const, confirmation: f.confirmation }

  const ipHash = input.ip ? hashIp(input.ip) : null
  if (ipHash) {
    const [recent] = await db
      .select({ n: count() })
      .from(formSubmission)
      .where(
        and(
          eq(formSubmission.formId, f.id),
          eq(formSubmission.ipHash, ipHash),
          gte(formSubmission.createdAt, new Date(Date.now() - RATE_LIMIT.windowMs)),
        ),
      )
    if ((recent?.n ?? 0) >= RATE_LIMIT.max)
      throw new FormError("Too many submissions. Try again later.", 429)
  }

  const parsed = answerSchema(fields).safeParse(input.answers ?? {})
  if (!parsed.success)
    throw new FormError("Please fix the highlighted fields.", 400, fieldErrors(parsed.error))
  // Drop empty optional answers so stored data stays tidy.
  const data = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined))

  await db.insert(formSubmission).values({
    formId: f.id,
    orgId: f.orgId,
    data,
    submittedBy: input.viewerId,
    ipHash,
  })

  await notify({
    orgId: f.orgId,
    to: await membersWithRole(f.orgId, ["owner", "admin"]),
    type: "form.submitted",
    title: `New response to ${f.title}`,
    link: `/forms/${f.id}/responses`,
  })
  return { ok: true as const, confirmation: f.confirmation }
}

// ---------- Responses (callers check `response: ["read"]`) ----------

export async function listSubmissions(
  ctx: Pick<FormsContext, "orgId">,
  formId: string,
  limit = 500,
) {
  const f = await own(ctx, formId)
  const rows = await db
    .select({
      id: formSubmission.id,
      data: formSubmission.data,
      createdAt: formSubmission.createdAt,
      submitterName: user.name,
      submitterEmail: user.email,
    })
    .from(formSubmission)
    .leftJoin(user, eq(user.id, formSubmission.submittedBy))
    .where(and(eq(formSubmission.formId, f.id), eq(formSubmission.orgId, ctx.orgId)))
    .orderBy(desc(formSubmission.createdAt))
    .limit(Math.min(limit, 10_000))
  return { form: f, fields: fieldsOf(f), rows }
}

export async function submissionsCsv(ctx: Pick<FormsContext, "orgId">, formId: string) {
  const { fields, rows } = await listSubmissions(ctx, formId, 10_000)
  const cell = (v: string) => {
    const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
    return `"${s.replace(/"/g, '""')}"`
  }
  const head = ["submitted_at", "submitted_by", ...fields.map((f) => f.label)].map(cell).join(",")
  const lines = rows.map((r) =>
    [
      r.createdAt.toISOString(),
      r.submitterEmail ?? "",
      ...fields.map((f) => displayAnswer(r.data[f.id])),
    ]
      .map(cell)
      .join(","),
  )
  return [head, ...lines].join("\n")
}
