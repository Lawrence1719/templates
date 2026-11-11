"use server"

import { AuthError, requirePermission } from "@templates/auth/guards"
import type { Permissions } from "@templates/auth/permissions"
import {
  type CountInput,
  countStock,
  createLocation,
  createProduct,
  deleteProduct,
  InventoryError,
  type IssueInput,
  issueStock,
  type LocationInput,
  type ProductInput,
  type ReceiveInput,
  receiveStock,
  setLocationStatus,
  setProductStatus,
  type TransferInput,
  transferStock,
  updateLocation,
  updateProduct,
} from "@templates/inventory"
import { redirect } from "next/navigation"

export type InventoryResult =
  | { ok: true; id?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

async function ctxWith(permission: Permissions) {
  const { user, orgId } = await requirePermission(permission)
  return { orgId, user: { id: user.id, name: user.name, email: user.email } }
}

async function run(
  fn: () => Promise<{ id?: string } | undefined | void>,
): Promise<InventoryResult> {
  try {
    const r = await fn()
    return { ok: true, ...(r ?? {}) }
  } catch (e) {
    if (e instanceof InventoryError)
      return { ok: false, error: e.message, fieldErrors: e.fieldErrors }
    if (e instanceof AuthError) return { ok: false, error: "You don't have permission to do that." }
    throw e
  }
}

const manage = { inventory: ["manage"] } satisfies Permissions
const move = { inventory: ["move"] } satisfies Permissions

export async function saveProductAction(id: string | null, input: ProductInput) {
  return run(async () => {
    const ctx = await ctxWith(manage)
    return { id: (id ? await updateProduct(ctx, id, input) : await createProduct(ctx, input)).id }
  })
}

export async function setProductStatusAction(id: string, archived: boolean) {
  return run(async () => {
    await setProductStatus(await ctxWith(manage), id, archived ? "archived" : "active")
  })
}

export async function deleteProductAction(id: string) {
  const r = await run(async () => {
    await deleteProduct(await ctxWith(manage), id)
  })
  if (r.ok) redirect("/inventory")
  return r
}

export async function receiveAction(productId: string, input: ReceiveInput) {
  return run(async () => {
    await receiveStock(await ctxWith(move), productId, input)
  })
}

export async function issueAction(productId: string, input: IssueInput) {
  return run(async () => {
    await issueStock(await ctxWith(move), productId, input)
  })
}

export async function transferAction(productId: string, input: TransferInput) {
  return run(async () => {
    await transferStock(await ctxWith(move), productId, input)
  })
}

export async function countAction(productId: string, input: CountInput) {
  return run(async () => {
    await countStock(await ctxWith({ inventory: ["adjust"] }), productId, input)
  })
}

export async function saveLocationAction(id: string | null, input: LocationInput) {
  return run(async () => {
    const ctx = await ctxWith(manage)
    const row = id ? await updateLocation(ctx, id, input) : await createLocation(ctx, input)
    return { id: row?.id }
  })
}

export async function setLocationStatusAction(id: string, archived: boolean) {
  return run(async () => {
    await setLocationStatus(await ctxWith(manage), id, archived ? "archived" : "active")
  })
}
