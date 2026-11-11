"use server"

import { AuthError, can, requirePermission } from "@templates/auth/guards"
import type { Permissions } from "@templates/auth/permissions"
import {
  type ActivityInput,
  addContact,
  type ContactInput,
  CrmError,
  type CustomerInput,
  createCustomer,
  createDeal,
  DEAL_STAGES,
  type DealInput,
  deleteActivity,
  deleteContact,
  deleteCustomer,
  deleteDeal,
  logActivity,
  moveDeal,
  updateContact,
  updateCustomer,
  updateDeal,
} from "@templates/crm"
import { redirect } from "next/navigation"
import { z } from "zod"

export type CrmResult =
  | { ok: true; id?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

async function ctxWith(permission: Permissions) {
  const { user, orgId } = await requirePermission(permission)
  return { orgId, user: { id: user.id, name: user.name, email: user.email } }
}

/** Turns expected errors into a result the form can show; anything else is a real bug and throws. */
async function run(fn: () => Promise<{ id?: string } | undefined | void>): Promise<CrmResult> {
  try {
    const r = await fn()
    return { ok: true, ...(r ?? {}) }
  } catch (e) {
    if (e instanceof CrmError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors }
    if (e instanceof AuthError) return { ok: false, error: "You don't have permission to do that." }
    throw e
  }
}

const write = { customer: ["write"] } satisfies Permissions
const dealWrite = { deal: ["write"] } satisfies Permissions

// ---------- Customers ----------

export async function createCustomerAction(input: CustomerInput) {
  return run(async () => ({ id: (await createCustomer(await ctxWith(write), input)).id }))
}

export async function updateCustomerAction(id: string, input: CustomerInput) {
  return run(async () => {
    await updateCustomer(await ctxWith(write), id, input)
  })
}

export async function deleteCustomerAction(id: string) {
  const r = await run(async () => {
    await deleteCustomer(await ctxWith({ customer: ["delete"] }), id)
  })
  if (r.ok) redirect("/customers")
  return r
}

// ---------- Contacts ----------

export async function addContactAction(customerId: string, input: ContactInput) {
  return run(async () => ({ id: (await addContact(await ctxWith(write), customerId, input)).id }))
}

export async function updateContactAction(id: string, input: ContactInput) {
  return run(async () => {
    await updateContact(await ctxWith(write), id, input)
  })
}

export async function deleteContactAction(id: string) {
  return run(async () => {
    await deleteContact(await ctxWith(write), id)
  })
}

// ---------- Timeline ----------

export async function logActivityAction(customerId: string, input: ActivityInput) {
  return run(async () => {
    await logActivity(await ctxWith(write), customerId, input)
  })
}

export async function deleteActivityAction(id: string) {
  return run(async () => {
    const ctx = await ctxWith(write)
    await deleteActivity(ctx, id, { canDeleteAny: await can({ customer: ["delete"] }) })
  })
}

// ---------- Deals ----------

export async function createDealAction(customerId: string, input: DealInput) {
  return run(async () => ({
    id: (await createDeal(await ctxWith(dealWrite), customerId, input)).id,
  }))
}

export async function updateDealAction(id: string, input: DealInput) {
  return run(async () => {
    await updateDeal(await ctxWith(dealWrite), id, input)
  })
}

const stageSchema = z.enum(DEAL_STAGES)

export async function moveDealAction(id: string, stage: string) {
  return run(async () => {
    const parsed = stageSchema.safeParse(stage)
    if (!parsed.success) throw new CrmError("Unknown stage.", 400)
    await moveDeal(await ctxWith(dealWrite), id, parsed.data)
  })
}

export async function deleteDealAction(id: string) {
  return run(async () => {
    await deleteDeal(await ctxWith({ deal: ["delete"] }), id)
  })
}
