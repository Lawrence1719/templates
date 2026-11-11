"use server"

import { AuthError, requirePermission } from "@templates/auth/guards"
import type { Permissions } from "@templates/auth/permissions"
import {
  addTimeOff,
  availability,
  BOOKING_STATUSES,
  BookingError,
  bookOnline,
  cancelByToken,
  createBooking,
  deleteTimeOff,
  type HoursInput,
  type ResourceInput,
  rotatePublicSlug,
  type ServiceInput,
  type SettingsInput,
  type StaffBookingInput,
  saveResource,
  saveService,
  setBookingStatus,
  setHours,
  setResourceStatus,
  setServiceStatus,
  type TimeOffInput,
  updateBookingSettings,
} from "@templates/bookings"
import { headers } from "next/headers"
import { z } from "zod"

export type BookingResult =
  | { ok: true; id?: string; token?: string | null; status?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

async function ctxWith(permission: Permissions) {
  const { user, orgId } = await requirePermission(permission)
  return { orgId, user: { id: user.id, name: user.name, email: user.email } }
}

async function run(
  fn: () => Promise<{ id?: string; token?: string | null; status?: string } | undefined | void>,
): Promise<BookingResult> {
  try {
    const r = await fn()
    return { ok: true, ...(r ?? {}) }
  } catch (e) {
    if (e instanceof BookingError)
      return { ok: false, error: e.message, fieldErrors: e.fieldErrors }
    if (e instanceof AuthError) return { ok: false, error: "You don't have permission to do that." }
    throw e
  }
}

const manage = { booking: ["manage"] } satisfies Permissions
const write = { booking: ["write"] } satisfies Permissions

// ---------- Staff ----------

export async function staffSlotsAction(serviceId: string, resourceId: string, day: string) {
  const { orgId } = await ctxWith({ booking: ["read"] })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return []
  const r = await availability(orgId, { serviceId, resourceId: resourceId || null, day })
  return r.slots.map((s) => s.startsAt.toISOString())
}

export async function createBookingAction(input: StaffBookingInput) {
  return run(async () => ({ id: (await createBooking(await ctxWith(write), input)).id }))
}

const statusSchema = z.enum(BOOKING_STATUSES)

export async function setBookingStatusAction(id: string, status: string, reason?: string) {
  return run(async () => {
    const s = statusSchema.safeParse(status)
    if (!s.success) throw new BookingError("Unknown status.", 400)
    await setBookingStatus(await ctxWith(write), id, s.data, reason)
  })
}

// ---------- Setup (admins) ----------

export async function saveSettingsAction(input: SettingsInput) {
  return run(async () => {
    await updateBookingSettings(await ctxWith(manage), input)
  })
}

export async function rotateLinkAction() {
  return run(async () => {
    await rotatePublicSlug(await ctxWith(manage))
  })
}

export async function saveServiceAction(id: string | null, input: ServiceInput) {
  return run(async () => ({ id: (await saveService(await ctxWith(manage), id, input)).id }))
}

export async function setServiceStatusAction(id: string, archived: boolean) {
  return run(async () => {
    await setServiceStatus(await ctxWith(manage), id, archived ? "archived" : "active")
  })
}

export async function saveResourceAction(id: string | null, input: ResourceInput) {
  return run(async () => ({ id: (await saveResource(await ctxWith(manage), id, input)).id }))
}

export async function setResourceStatusAction(id: string, archived: boolean) {
  return run(async () => {
    await setResourceStatus(await ctxWith(manage), id, archived ? "archived" : "active")
  })
}

export async function setHoursAction(resourceId: string, input: HoursInput) {
  return run(async () => {
    await setHours(await ctxWith(manage), resourceId, input)
  })
}

export async function addTimeOffAction(input: TimeOffInput) {
  return run(async () => {
    await addTimeOff(await ctxWith(write), input)
  })
}

export async function deleteTimeOffAction(id: string) {
  return run(async () => {
    await deleteTimeOff(await ctxWith(write), id)
  })
}

// ---------- Public (no account) ----------

/** Anyone with the booking link may call this; bookOnline() enforces the link, slots, honeypot and rate limit. */
export async function bookOnlineAction(slug: string, data: unknown, honeypot: string) {
  const h = await headers()
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null
  return run(async () => {
    const r = await bookOnline({ slug, data, honeypot, ip })
    return { token: r.token, status: r.status }
  })
}

/** The manage link is the credential. */
export async function cancelByTokenAction(token: string, reason: string) {
  return run(async () => {
    await cancelByToken(token, reason)
  })
}
