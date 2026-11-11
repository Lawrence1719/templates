"use server"

import { AuthError, can, requirePermission } from "@templates/auth/guards"
import type { Permissions } from "@templates/auth/permissions"
import {
  type CheckInResult,
  cancelMembership,
  checkIn,
  emailCard,
  findMembers,
  MembershipError,
  type PlanInput,
  pauseMembership,
  type RenewInput,
  renewMembership,
  replaceCard,
  resumeMembership,
  type SettingsInput,
  type StartInput,
  savePlan,
  setAutoRenew,
  setPlanStatus,
  startMembership,
  updateMembershipSettings,
  voidCheckIn,
} from "@templates/memberships"

export type MembershipResult =
  | { ok: true; id?: string; emailed?: boolean }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

async function ctxWith(permission: Permissions) {
  const { user, orgId } = await requirePermission(permission)
  return { orgId, user: { id: user.id, name: user.name, email: user.email } }
}

async function run(
  fn: () => Promise<{ id?: string; emailed?: boolean } | undefined | void>,
): Promise<MembershipResult> {
  try {
    const r = await fn()
    return { ok: true, ...(r ?? {}) }
  } catch (e) {
    if (e instanceof MembershipError)
      return { ok: false, error: e.message, fieldErrors: e.fieldErrors }
    if (e instanceof AuthError) return { ok: false, error: "You don't have permission to do that." }
    throw e
  }
}

const sell = { membership: ["sell"] } satisfies Permissions
const desk = { membership: ["checkin"] } satisfies Permissions
const manage = { membership: ["manage"] } satisfies Permissions

// ---------- Front desk ----------

export async function checkInAction(
  by: { code: string } | { membershipId: string },
): Promise<CheckInResult> {
  const ctx = await ctxWith(desk).catch(() => null)
  if (!ctx) return { ok: false, reason: "You don't have permission to check people in." }
  try {
    return await checkIn(
      ctx,
      "code" in by
        ? { code: String(by.code).slice(0, 80) }
        : { membershipId: String(by.membershipId) },
    )
  } catch (e) {
    if (e instanceof MembershipError) return { ok: false, reason: e.message }
    throw e
  }
}

export async function voidCheckInAction(id: string) {
  return run(async () => {
    const ctx = await ctxWith(desk)
    await voidCheckIn(ctx, id, { asManager: await can(manage) })
  })
}

export async function findMembersAction(q: string) {
  const ctx = await ctxWith(desk).catch(() => null)
  if (!ctx) return []
  return (await findMembers(ctx, String(q))).map((m) => ({
    id: m.id,
    customerName: m.customerName,
    planName: m.planName,
    state: m.state,
    periodEnd: m.periodEnd,
  }))
}

// ---------- Selling ----------

export async function startMembershipAction(input: StartInput) {
  return run(async () => ({ id: (await startMembership(await ctxWith(sell), input)).id }))
}

export async function renewMembershipAction(id: string, input: RenewInput) {
  return run(async () => {
    await renewMembership(await ctxWith(sell), id, input)
  })
}

export async function pauseMembershipAction(id: string) {
  return run(async () => {
    await pauseMembership(await ctxWith(sell), id)
  })
}

export async function resumeMembershipAction(id: string) {
  return run(async () => {
    await resumeMembership(await ctxWith(sell), id)
  })
}

export async function setAutoRenewAction(id: string, on: boolean) {
  return run(async () => {
    await setAutoRenew(await ctxWith(sell), id, on)
  })
}

export async function replaceCardAction(id: string) {
  return run(async () => {
    await replaceCard(await ctxWith(sell), id)
  })
}

export async function emailCardAction(id: string) {
  return run(async () => ({ emailed: await emailCard(await ctxWith(sell), id) }))
}

// ---------- Admins ----------

export async function cancelMembershipAction(id: string, reason: string) {
  return run(async () => {
    await cancelMembership(await ctxWith(manage), id, reason)
  })
}

export async function savePlanAction(id: string | null, input: PlanInput) {
  return run(async () => ({ id: (await savePlan(await ctxWith(manage), id, input)).id }))
}

export async function setPlanStatusAction(id: string, archived: boolean) {
  return run(async () => {
    await setPlanStatus(await ctxWith(manage), id, archived ? "archived" : "active")
  })
}

export async function saveMembershipSettingsAction(input: SettingsInput) {
  return run(async () => {
    await updateMembershipSettings(await ctxWith(manage), input)
  })
}
