"use server"

import { auth } from "@templates/auth"
import { requirePermission } from "@templates/auth/guards"
import {
  createForm,
  deleteForm,
  FormError,
  saveForm,
  setFormStatus,
  submitForm,
} from "@templates/forms"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { z } from "zod"

type Result = { ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string> }

const asResult = (e: unknown): Result => {
  if (e instanceof FormError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors }
  throw e
}

async function manager() {
  const { user, orgId } = await requirePermission({ form: ["manage"] })
  return { orgId, user: { id: user.id, name: user.name, email: user.email } }
}

export async function newFormAction() {
  const f = await createForm(await manager())
  redirect(`/forms/${f.id}`)
}

export async function saveFormAction(id: string, settings: unknown): Promise<Result> {
  try {
    await saveForm(await manager(), id, settings)
    return { ok: true }
  } catch (e) {
    return asResult(e)
  }
}

const statusSchema = z.enum(["draft", "published", "closed"])

export async function setFormStatusAction(id: string, status: string): Promise<Result> {
  try {
    await setFormStatus(await manager(), id, statusSchema.parse(status))
    return { ok: true }
  } catch (e) {
    return asResult(e)
  }
}

export async function deleteFormAction(id: string) {
  await deleteForm(await manager(), id)
  redirect("/forms")
}

/** Public: anyone with the link may call this; submitForm() enforces status, visibility and limits. */
export async function submitFormAction(slug: string, answers: unknown, honeypot: string) {
  const h = await headers()
  const session = await auth.api.getSession({ headers: h }).catch(() => null)
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null
  try {
    const r = await submitForm({ slug, answers, honeypot, ip, viewerId: session?.user.id ?? null })
    return { ok: true as const, confirmation: r.confirmation }
  } catch (e) {
    return asResult(e)
  }
}

export type { Result }
