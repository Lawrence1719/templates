"use server"

import { AuthError, can, requirePermission } from "@templates/auth/guards"
import type { Permissions } from "@templates/auth/permissions"
import {
  type CashMovementInput,
  type CheckoutInput,
  type CloseShiftInput,
  checkout,
  closeShift,
  type OpenShiftInput,
  openShift,
  PosError,
  type RefundInput,
  type RegisterInput,
  recordCashMovement,
  refundSale,
  type SettingsInput,
  saveRegister,
  setRegisterStatus,
  updatePosSettings,
} from "@templates/pos"

export type PosResult =
  | {
      ok: true
      id?: string
      number?: string
      changeCents?: number
      replay?: boolean
    }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

async function ctxWith(permission: Permissions) {
  const { user, orgId } = await requirePermission(permission)
  return { orgId, user: { id: user.id, name: user.name, email: user.email } }
}

async function run(
  fn: () => Promise<Omit<Extract<PosResult, { ok: true }>, "ok"> | undefined | void>,
): Promise<PosResult> {
  try {
    const r = await fn()
    return { ok: true, ...(r ?? {}) }
  } catch (e) {
    if (e instanceof PosError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors }
    if (e instanceof AuthError) return { ok: false, error: "You don't have permission to do that." }
    throw e
  }
}

const sell = { pos: ["sell"] } satisfies Permissions
const manage = { pos: ["manage"] } satisfies Permissions

// ---------- The till ----------

export async function checkoutAction(input: CheckoutInput) {
  return run(async () => {
    const ctx = await ctxWith(sell)
    const r = await checkout(ctx, input, { canOverrideDiscount: await can(manage) })
    return { id: r.sale.id, number: r.sale.number, changeCents: r.changeCents, replay: r.replay }
  })
}

export async function openShiftAction(registerId: string, input: OpenShiftInput) {
  return run(async () => ({ id: (await openShift(await ctxWith(sell), registerId, input)).id }))
}

export async function cashMovementAction(shiftId: string, input: CashMovementInput) {
  return run(async () => {
    await recordCashMovement(await ctxWith(sell), shiftId, input)
  })
}

/** Cashiers close their own drawer; the count is blind, so the expected amount isn't shown first. */
export async function closeShiftAction(shiftId: string, input: CloseShiftInput) {
  return run(async () => ({ id: (await closeShift(await ctxWith(sell), shiftId, input)).id }))
}

export async function refundAction(saleId: string, input: RefundInput) {
  return run(async () => ({
    id: (await refundSale(await ctxWith({ pos: ["refund"] }), saleId, input)).id,
  }))
}

// ---------- Setup (admins) ----------

export async function savePosSettingsAction(input: SettingsInput) {
  return run(async () => {
    await updatePosSettings(await ctxWith(manage), input)
  })
}

export async function saveRegisterAction(id: string | null, input: RegisterInput) {
  return run(async () => ({ id: (await saveRegister(await ctxWith(manage), id, input)).id }))
}

export async function setRegisterStatusAction(id: string, archived: boolean) {
  return run(async () => {
    await setRegisterStatus(await ctxWith(manage), id, archived ? "archived" : "active")
  })
}
