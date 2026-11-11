"use server"

import { AuthError, requirePermission } from "@templates/auth/guards"
import type { Permissions } from "@templates/auth/permissions"
import {
  addOrderNote,
  cancelOrder,
  confirmOrder,
  createOrder,
  deleteDraftOrder,
  duplicateOrder,
  fulfillOrder,
  invoiceOrder,
  OrderError,
  type OrderInput,
  updateOrder,
} from "@templates/orders"
import { redirect } from "next/navigation"

export type OrderResult =
  | { ok: true; id?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

async function ctxWith(permission: Permissions) {
  const { user, orgId } = await requirePermission(permission)
  return { orgId, user: { id: user.id, name: user.name, email: user.email } }
}

async function run(fn: () => Promise<{ id?: string } | undefined | void>): Promise<OrderResult> {
  try {
    const r = await fn()
    return { ok: true, ...(r ?? {}) }
  } catch (e) {
    if (e instanceof OrderError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors }
    if (e instanceof AuthError) return { ok: false, error: "You don't have permission to do that." }
    throw e
  }
}

const write = { order: ["write"] } satisfies Permissions

export async function saveOrderAction(id: string | null, input: OrderInput) {
  return run(async () => {
    const ctx = await ctxWith(write)
    return { id: (id ? await updateOrder(ctx, id, input) : await createOrder(ctx, input)).id }
  })
}

export async function confirmOrderAction(id: string) {
  return run(async () => {
    await confirmOrder(await ctxWith({ order: ["confirm"] }), id)
  })
}

export async function fulfillOrderAction(id: string, locationId: string | null) {
  return run(async () => {
    await fulfillOrder(await ctxWith({ order: ["fulfill"], inventory: ["move"] }), id, {
      locationId,
    })
  })
}

export async function cancelOrderAction(id: string, reason: string) {
  return run(async () => {
    await cancelOrder(await ctxWith({ order: ["cancel"] }), id, reason)
  })
}

export async function invoiceOrderAction(id: string) {
  return run(async () => {
    const inv = await invoiceOrder(await ctxWith({ order: ["read"], invoice: ["write"] }), id)
    return { id: inv.id }
  })
}

export async function duplicateOrderAction(id: string) {
  return run(async () => ({ id: (await duplicateOrder(await ctxWith(write), id)).id }))
}

export async function deleteDraftOrderAction(id: string) {
  const r = await run(async () => {
    await deleteDraftOrder(await ctxWith(write), id)
  })
  if (r.ok) redirect("/orders")
  return r
}

export async function addOrderNoteAction(id: string, body: string) {
  return run(async () => {
    await addOrderNote(await ctxWith({ order: ["read"] }), id, body)
  })
}
