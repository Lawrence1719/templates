import "server-only"

import { createHmac, randomBytes } from "node:crypto"

import { audit } from "@templates/audit"
import { db } from "@templates/db"
import {
  type Booking,
  booking,
  bookingHours,
  bookingResource,
  bookingService,
  bookingSettings,
  bookingTimeOff,
  customer,
  member,
  organization,
  user,
} from "@templates/db/schema"
import { appUrl, membersWithRole, notify, renderEmail, sendEmail } from "@templates/notifications"
import { and, asc, count, eq, gt, gte, inArray, lt, type SQL, sql } from "drizzle-orm"
import { z } from "zod"

import {
  ACTIVE_STATUSES,
  addDays,
  type BookingStatus,
  computeSlots,
  fieldErrors,
  formatDate,
  formatTime,
  type HoursInput,
  hoursInputSchema,
  localParts,
  ONLINE_RATE_LIMIT,
  type OnlineBookingInput,
  onlineBookingSchema,
  type ResourceInput,
  resourceInputSchema,
  type ServiceInput,
  type SettingsInput,
  type StaffBookingInput,
  serviceInputSchema,
  settingsInputSchema,
  staffBookingSchema,
  type TimeOffInput,
  timeOffInputSchema,
  today,
  weekdayOf,
  zonedToUtc,
} from "./definitions"

export type BookingsContext = { orgId: string; user: { id: string; name: string; email: string } }

export class BookingError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 429,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(message)
  }
}

const isUuid = (s: string) => z.uuid().safeParse(s).success
const notFound = () => new BookingError("Not found", 404)
const conflict = (m: string) => new BookingError(m, 409)
const invalid = (fe: Record<string, string>) =>
  new BookingError("Please fix the highlighted fields.", 400, fe)
const taken = () =>
  new BookingError("That time was just taken. Please pick another.", 409, {
    startsAt: "No longer free",
  })

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input)
  if (!r.success) throw invalid(fieldErrors(r.error))
  return r.data
}

const pgCode = (e: unknown): string | undefined => {
  const err = e as { code?: string; cause?: unknown } | null
  return err?.code ?? (err?.cause ? pgCode(err.cause) : undefined)
}
const newToken = () => randomBytes(18).toString("base64url")
const hashIp = (ip: string) =>
  createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "dev-secret")
    .update(ip)
    .digest("hex")
    .slice(0, 32)

// ---------- Settings ----------

export async function getBookingSettings(ctx: Pick<BookingsContext, "orgId">) {
  await db
    .insert(bookingSettings)
    .values({ orgId: ctx.orgId, publicSlug: randomBytes(8).toString("base64url") })
    .onConflictDoNothing()
  const [s] = await db.select().from(bookingSettings).where(eq(bookingSettings.orgId, ctx.orgId))
  if (!s) throw new Error("booking settings missing")
  return s
}

export async function updateBookingSettings(ctx: BookingsContext, input: SettingsInput) {
  await getBookingSettings(ctx)
  const v = parse(settingsInputSchema, input)
  const [row] = await db
    .update(bookingSettings)
    .set(v)
    .where(eq(bookingSettings.orgId, ctx.orgId))
    .returning()
  await audit(ctx, "booking_settings.updated", "Updated booking settings")
  return row
}

/** Makes a new public link; the old one stops working. */
export async function rotatePublicSlug(ctx: BookingsContext) {
  await getBookingSettings(ctx)
  await db
    .update(bookingSettings)
    .set({ publicSlug: randomBytes(8).toString("base64url") })
    .where(eq(bookingSettings.orgId, ctx.orgId))
  await audit(ctx, "booking_settings.link_rotated", "Replaced the public booking link")
}

// ---------- Services and resources ----------

export async function listServices(
  ctx: Pick<BookingsContext, "orgId">,
  opts: { includeArchived?: boolean } = {},
) {
  return db
    .select()
    .from(bookingService)
    .where(
      and(
        eq(bookingService.orgId, ctx.orgId),
        opts.includeArchived ? undefined : eq(bookingService.status, "active"),
      ),
    )
    .orderBy(asc(bookingService.status), asc(bookingService.name))
}

async function checkResourceIds(ctx: Pick<BookingsContext, "orgId">, ids: string[]) {
  if (!ids.length) return
  const found = await db
    .select({ id: bookingResource.id })
    .from(bookingResource)
    .where(and(eq(bookingResource.orgId, ctx.orgId), inArray(bookingResource.id, ids)))
  if (found.length !== new Set(ids).size)
    throw invalid({ resourceIds: "Choose from your own team and rooms" })
}

export async function saveService(ctx: BookingsContext, id: string | null, input: ServiceInput) {
  const { price, ...v } = parse(serviceInputSchema, input)
  await checkResourceIds(ctx, v.resourceIds)
  const values = { ...v, resourceIds: [...new Set(v.resourceIds)], priceCents: price }
  if (id) {
    if (!isUuid(id)) throw notFound()
    const [row] = await db
      .update(bookingService)
      .set(values)
      .where(and(eq(bookingService.id, id), eq(bookingService.orgId, ctx.orgId)))
      .returning()
    if (!row) throw notFound()
    return row
  }
  const [row] = await db
    .insert(bookingService)
    .values({ ...values, orgId: ctx.orgId })
    .returning()
  if (!row) throw new Error("insert failed")
  await audit(ctx, "booking_service.created", `Added service ${row.name}`, {
    target: { type: "booking_service", id: row.id },
  })
  return row
}

export async function setServiceStatus(
  ctx: BookingsContext,
  id: string,
  status: "active" | "archived",
) {
  if (!isUuid(id)) throw notFound()
  const [row] = await db
    .update(bookingService)
    .set({ status })
    .where(and(eq(bookingService.id, id), eq(bookingService.orgId, ctx.orgId)))
    .returning()
  if (!row) throw notFound()
}

export async function listResources(
  ctx: Pick<BookingsContext, "orgId">,
  opts: { includeArchived?: boolean } = {},
) {
  const [resources, hours] = await Promise.all([
    db
      .select({
        id: bookingResource.id,
        name: bookingResource.name,
        userId: bookingResource.userId,
        status: bookingResource.status,
      })
      .from(bookingResource)
      .where(
        and(
          eq(bookingResource.orgId, ctx.orgId),
          opts.includeArchived ? undefined : eq(bookingResource.status, "active"),
        ),
      )
      .orderBy(asc(bookingResource.status), asc(bookingResource.name)),
    db
      .select()
      .from(bookingHours)
      .where(eq(bookingHours.orgId, ctx.orgId))
      .orderBy(asc(bookingHours.weekday), asc(bookingHours.startMinute)),
  ])
  return resources.map((r) => ({ ...r, hours: hours.filter((h) => h.resourceId === r.id) }))
}

async function assertMember(ctx: Pick<BookingsContext, "orgId">, userId: string | null) {
  if (!userId) return
  const [m] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, ctx.orgId), eq(member.userId, userId)))
  if (!m) throw invalid({ userId: "Choose someone in this organization" })
}

export async function saveResource(ctx: BookingsContext, id: string | null, input: ResourceInput) {
  const v = parse(resourceInputSchema, input)
  await assertMember(ctx, v.userId)
  if (id) {
    if (!isUuid(id)) throw notFound()
    const [row] = await db
      .update(bookingResource)
      .set(v)
      .where(and(eq(bookingResource.id, id), eq(bookingResource.orgId, ctx.orgId)))
      .returning()
    if (!row) throw notFound()
    return row
  }
  const [row] = await db
    .insert(bookingResource)
    .values({ ...v, orgId: ctx.orgId })
    .returning()
  if (!row) throw new Error("insert failed")
  // Start with weekday 9–5 so it's bookable straight away.
  await db.insert(bookingHours).values(
    [1, 2, 3, 4, 5].map((weekday) => ({
      orgId: ctx.orgId,
      resourceId: row.id,
      weekday,
      startMinute: 540,
      endMinute: 1020,
    })),
  )
  await audit(ctx, "booking_resource.created", `Added ${row.name} to bookings`, {
    target: { type: "booking_resource", id: row.id },
  })
  return row
}

export async function setResourceStatus(
  ctx: BookingsContext,
  id: string,
  status: "active" | "archived",
) {
  if (!isUuid(id)) throw notFound()
  const [row] = await db
    .update(bookingResource)
    .set({ status })
    .where(and(eq(bookingResource.id, id), eq(bookingResource.orgId, ctx.orgId)))
    .returning()
  if (!row) throw notFound()
}

async function ownResource(ctx: Pick<BookingsContext, "orgId">, id: string, field = "resourceId") {
  const [r] = isUuid(id)
    ? await db
        .select()
        .from(bookingResource)
        .where(and(eq(bookingResource.id, id), eq(bookingResource.orgId, ctx.orgId)))
    : []
  if (!r) throw invalid({ [field]: "Choose from the list" })
  return r
}

/** Replaces a resource's weekly hours. */
export async function setHours(ctx: BookingsContext, resourceId: string, input: HoursInput) {
  const r = await ownResource(ctx, resourceId)
  const rows = parse(hoursInputSchema, input)
  await db.transaction(async (tx) => {
    await tx.delete(bookingHours).where(eq(bookingHours.resourceId, r.id))
    if (rows.length)
      await tx
        .insert(bookingHours)
        .values(rows.map((h) => ({ ...h, orgId: ctx.orgId, resourceId: r.id })))
  })
}

export async function addTimeOff(ctx: BookingsContext, input: TimeOffInput) {
  const v = parse(timeOffInputSchema, input)
  await ownResource(ctx, v.resourceId)
  const s = await getBookingSettings(ctx)
  const toUtc = (local: string) => {
    const [day, clock] = local.split("T") as [string, string]
    const [h, m] = clock.split(":").map(Number) as [number, number]
    return zonedToUtc(day, h * 60 + m, s.timeZone)
  }
  const startsAt = toUtc(v.startsAt)
  const endsAt = toUtc(v.endsAt)
  if (!startsAt || !endsAt)
    throw invalid({ startsAt: "That time doesn't exist in your time zone (clock change)" })
  const [row] = await db
    .insert(bookingTimeOff)
    .values({
      orgId: ctx.orgId,
      resourceId: v.resourceId,
      startsAt,
      endsAt,
      reason: v.reason,
      createdBy: ctx.user.id,
    })
    .returning()
  return row
}

export async function deleteTimeOff(ctx: BookingsContext, id: string) {
  if (!isUuid(id)) throw notFound()
  await db
    .delete(bookingTimeOff)
    .where(and(eq(bookingTimeOff.id, id), eq(bookingTimeOff.orgId, ctx.orgId)))
}

export async function listTimeOff(ctx: Pick<BookingsContext, "orgId">) {
  return db
    .select({
      id: bookingTimeOff.id,
      resourceId: bookingTimeOff.resourceId,
      resourceName: bookingResource.name,
      startsAt: bookingTimeOff.startsAt,
      endsAt: bookingTimeOff.endsAt,
      reason: bookingTimeOff.reason,
    })
    .from(bookingTimeOff)
    .innerJoin(bookingResource, eq(bookingResource.id, bookingTimeOff.resourceId))
    .where(and(eq(bookingTimeOff.orgId, ctx.orgId), gt(bookingTimeOff.endsAt, new Date())))
    .orderBy(asc(bookingTimeOff.startsAt))
    .limit(200)
}

// ---------- Availability ----------

/**
 * Free start times on a day (in the org's zone) for a service, per resource.
 * `resourceId: null` means anyone who offers the service.
 */
export async function availability(
  orgId: string,
  opts: { serviceId: string; resourceId: string | null; day: string; now?: Date },
) {
  const now = opts.now ?? new Date()
  const settings = await getBookingSettings({ orgId })
  if (!isUuid(opts.serviceId)) return { slots: [], timeZone: settings.timeZone }
  const [svc] = await db
    .select()
    .from(bookingService)
    .where(
      and(
        eq(bookingService.id, opts.serviceId),
        eq(bookingService.orgId, orgId),
        eq(bookingService.status, "active"),
      ),
    )
  if (!svc) return { slots: [], timeZone: settings.timeZone }

  const where: SQL[] = [eq(bookingResource.orgId, orgId), eq(bookingResource.status, "active")]
  if (opts.resourceId) {
    if (!isUuid(opts.resourceId)) return { slots: [], timeZone: settings.timeZone }
    where.push(eq(bookingResource.id, opts.resourceId))
  }
  if (svc.resourceIds.length) where.push(inArray(bookingResource.id, svc.resourceIds))
  const resources = await db
    .select({ id: bookingResource.id })
    .from(bookingResource)
    .where(and(...where))
  if (!resources.length) return { slots: [], timeZone: settings.timeZone }
  const ids = resources.map((r) => r.id)

  // Anything that could touch this day, padded a day either side for zone offsets.
  const from = new Date(`${addDays(opts.day, -1)}T00:00:00Z`)
  const to = new Date(`${addDays(opts.day, 2)}T00:00:00Z`)
  const [hours, taken, off] = await Promise.all([
    db
      .select()
      .from(bookingHours)
      .where(
        and(inArray(bookingHours.resourceId, ids), eq(bookingHours.weekday, weekdayOf(opts.day))),
      ),
    db
      .select({
        resourceId: booking.resourceId,
        start: booking.startsAt,
        end: booking.blockedUntil,
      })
      .from(booking)
      .where(
        and(
          inArray(booking.resourceId, ids),
          inArray(booking.status, [...ACTIVE_STATUSES]),
          lt(booking.startsAt, to),
          gt(booking.blockedUntil, from),
        ),
      ),
    db
      .select({
        resourceId: bookingTimeOff.resourceId,
        start: bookingTimeOff.startsAt,
        end: bookingTimeOff.endsAt,
      })
      .from(bookingTimeOff)
      .where(
        and(
          inArray(bookingTimeOff.resourceId, ids),
          lt(bookingTimeOff.startsAt, to),
          gt(bookingTimeOff.endsAt, from),
        ),
      ),
  ])

  const byTime = new Map<number, string[]>()
  for (const id of ids) {
    const slots = computeSlots({
      day: opts.day,
      timeZone: settings.timeZone,
      hours: hours.filter((h) => h.resourceId === id),
      durationMinutes: svc.durationMinutes,
      bufferMinutes: svc.bufferMinutes,
      stepMinutes: settings.slotMinutes,
      busy: [...taken, ...off].filter((b) => b.resourceId === id),
      now,
      minNoticeMinutes: settings.minNoticeMinutes,
      maxDaysAhead: settings.maxDaysAhead,
    })
    for (const s of slots) byTime.set(s.getTime(), [...(byTime.get(s.getTime()) ?? []), id])
  }
  return {
    timeZone: settings.timeZone,
    service: svc,
    slots: [...byTime.entries()]
      .sort(([a], [b]) => a - b)
      .map(([t, resourceIds]) => ({ startsAt: new Date(t), resourceIds })),
  }
}

// ---------- Making bookings ----------

/** Inserts a booking; the database's overlap constraint is the final word. */
async function insertBooking(values: typeof booking.$inferInsert) {
  try {
    const [row] = await db.insert(booking).values(values).returning()
    if (!row) throw new Error("insert failed")
    return row
  } catch (e) {
    if (pgCode(e) === "23P01") throw taken()
    throw e
  }
}

async function serviceFor(orgId: string, serviceId: string, resourceId: string) {
  const [svc] = await db
    .select()
    .from(bookingService)
    .where(
      and(
        eq(bookingService.id, serviceId),
        eq(bookingService.orgId, orgId),
        eq(bookingService.status, "active"),
      ),
    )
  if (!svc) throw invalid({ serviceId: "Choose a service from the list" })
  if (svc.resourceIds.length && !svc.resourceIds.includes(resourceId))
    throw invalid({ resourceId: `${svc.name} isn't offered by them` })
  return svc
}

/** Staff booking: any time (even outside hours), but never on top of another booking. */
export async function createBooking(ctx: BookingsContext, input: StaffBookingInput) {
  const v = parse(staffBookingSchema, input)
  const res = await ownResource(ctx, v.resourceId)
  if (res.status !== "active") throw invalid({ resourceId: "They're archived" })
  const svc = await serviceFor(ctx.orgId, v.serviceId, res.id)
  if (v.customerId) {
    const [c] = await db
      .select({ id: customer.id })
      .from(customer)
      .where(and(eq(customer.id, v.customerId), eq(customer.orgId, ctx.orgId)))
    if (!c) throw invalid({ customerId: "Choose a customer from the list" })
  }
  const endsAt = new Date(v.startsAt.getTime() + svc.durationMinutes * 60_000)
  const row = await insertBooking({
    orgId: ctx.orgId,
    serviceId: svc.id,
    resourceId: res.id,
    customerId: v.customerId,
    customerName: v.customerName,
    customerEmail: v.customerEmail,
    customerPhone: v.customerPhone,
    notes: v.notes,
    startsAt: v.startsAt,
    endsAt,
    blockedUntil: new Date(endsAt.getTime() + svc.bufferMinutes * 60_000),
    status: "confirmed",
    source: "staff",
    manageToken: newToken(),
    createdBy: ctx.user.id,
  })
  return row
}

/**
 * Online booking from the public page. The slot is re-checked against live
 * availability; a hidden honeypot field and a per-IP limit keep bots out.
 */
export async function bookOnline(input: {
  slug: string
  data: unknown
  honeypot?: string
  ip: string | null
}) {
  const settings = await publicSettings(input.slug)
  if (!settings) throw notFound()
  const v = parse(onlineBookingSchema, input.data)
  // Pretend success to bots so they don't adapt.
  if (input.honeypot) return { token: null, status: "pending" as BookingStatus }

  const ipHash = input.ip ? hashIp(input.ip) : null
  if (ipHash) {
    const [recent] = await db
      .select({ n: count() })
      .from(booking)
      .where(
        and(
          eq(booking.orgId, settings.orgId),
          eq(booking.ipHash, ipHash),
          gte(booking.createdAt, new Date(Date.now() - ONLINE_RATE_LIMIT.windowMs)),
        ),
      )
    if ((recent?.n ?? 0) >= ONLINE_RATE_LIMIT.max)
      throw new BookingError("Too many bookings from here. Try again later.", 429)
  }

  const day = localParts(v.startsAt, settings.timeZone).day
  const { slots, service } = await availability(settings.orgId, {
    serviceId: v.serviceId,
    resourceId: v.resourceId === "any" ? null : v.resourceId,
    day,
  })
  const slot = slots.find((s) => s.startsAt.getTime() === v.startsAt.getTime())
  if (!slot || !service) throw taken()

  const endsAt = new Date(v.startsAt.getTime() + service.durationMinutes * 60_000)
  let row: Booking | null = null
  // "Anyone": try each free resource until one sticks (someone may book at the same moment).
  for (const resourceId of slot.resourceIds) {
    try {
      row = await insertBooking({
        orgId: settings.orgId,
        serviceId: service.id,
        resourceId,
        customerName: v.customerName,
        customerEmail: v.customerEmail,
        customerPhone: v.customerPhone,
        notes: v.notes,
        startsAt: v.startsAt,
        endsAt,
        blockedUntil: new Date(endsAt.getTime() + service.bufferMinutes * 60_000),
        status: settings.requireApproval ? "pending" : "confirmed",
        source: "online",
        manageToken: newToken(),
        ipHash,
      })
      break
    } catch (e) {
      if (!(e instanceof BookingError && e.status === 409)) throw e
    }
  }
  if (!row) throw taken()

  await Promise.all([
    notifyStaff(
      settings.orgId,
      row,
      "booking.created",
      `New booking: ${service.name}, ${formatDate(row.startsAt, settings.timeZone)} ${formatTime(row.startsAt, settings.timeZone)}`,
    ),
    emailCustomer(row, row.status === "pending" ? "received" : "confirmed"),
  ])
  return { token: row.manageToken, status: row.status }
}

async function publicSettings(slug: string) {
  if (!/^[A-Za-z0-9_-]{8,32}$/.test(slug)) return null
  const [s] = await db
    .select()
    .from(bookingSettings)
    .where(and(eq(bookingSettings.publicSlug, slug), eq(bookingSettings.publicEnabled, true)))
  return s ?? null
}

/** What the public page shows: the business name, its services and who can be picked. Nothing about other bookings. */
export async function getPublicBookingPage(slug: string) {
  const s = await publicSettings(slug)
  if (!s) return null
  const [[org], services, resources] = await Promise.all([
    db.select({ name: organization.name }).from(organization).where(eq(organization.id, s.orgId)),
    db
      .select({
        id: bookingService.id,
        name: bookingService.name,
        description: bookingService.description,
        durationMinutes: bookingService.durationMinutes,
        priceCents: bookingService.priceCents,
        currency: bookingService.currency,
        resourceIds: bookingService.resourceIds,
      })
      .from(bookingService)
      .where(and(eq(bookingService.orgId, s.orgId), eq(bookingService.status, "active")))
      .orderBy(asc(bookingService.name)),
    db
      .select({ id: bookingResource.id, name: bookingResource.name })
      .from(bookingResource)
      .where(and(eq(bookingResource.orgId, s.orgId), eq(bookingResource.status, "active")))
      .orderBy(asc(bookingResource.name)),
  ])
  return {
    orgId: s.orgId,
    orgName: org?.name ?? "",
    timeZone: s.timeZone,
    maxDaysAhead: s.maxDaysAhead,
    requireApproval: s.requireApproval,
    services,
    resources,
  }
}

export async function publicAvailability(
  slug: string,
  q: { serviceId: string; resourceId: string; day: string },
) {
  const s = await publicSettings(slug)
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(q.day)) return null
  const r = await availability(s.orgId, {
    serviceId: q.serviceId,
    resourceId: q.resourceId === "any" ? null : q.resourceId,
    day: q.day,
  })
  // Only times leave the server, never who else is booked.
  return { timeZone: r.timeZone, slots: r.slots.map((x) => x.startsAt.toISOString()) }
}

// ---------- Managing a booking by its link ----------

export async function getBookingByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{24}$/.test(token)) return null
  const [row] = await db
    .select({
      booking,
      serviceName: bookingService.name,
      resourceName: bookingResource.name,
      orgName: organization.name,
      timeZone: bookingSettings.timeZone,
      cancelNoticeMinutes: bookingSettings.cancelNoticeMinutes,
    })
    .from(booking)
    .innerJoin(bookingService, eq(bookingService.id, booking.serviceId))
    .innerJoin(bookingResource, eq(bookingResource.id, booking.resourceId))
    .innerJoin(organization, eq(organization.id, booking.orgId))
    .innerJoin(bookingSettings, eq(bookingSettings.orgId, booking.orgId))
    .where(eq(booking.manageToken, token))
  if (!row) return null
  const b = row.booking
  const canCancel =
    (b.status === "pending" || b.status === "confirmed") &&
    Date.now() <= b.startsAt.getTime() - row.cancelNoticeMinutes * 60_000
  return { ...row, canCancel }
}

export async function cancelByToken(token: string, reason?: string | null) {
  const found = await getBookingByToken(token)
  if (!found) throw notFound()
  if (!found.canCancel)
    throw conflict(
      found.booking.status === "cancelled"
        ? "This booking is already cancelled."
        : "It's too late to cancel online. Please contact us.",
    )
  const [row] = await db
    .update(booking)
    .set({
      status: "cancelled",
      cancelReason: reason?.trim().slice(0, 500) || "Cancelled by the customer",
    })
    .where(and(eq(booking.id, found.booking.id), inArray(booking.status, [...ACTIVE_STATUSES])))
    .returning()
  if (!row) throw conflict("This booking is already cancelled.")
  await notifyStaff(
    row.orgId,
    row,
    "booking.cancelled",
    `Cancelled by the customer: ${found.serviceName}, ${formatDate(row.startsAt, found.timeZone)} ${formatTime(row.startsAt, found.timeZone)}`,
  )
  return row
}

// ---------- Staff views and actions ----------

export async function listBookings(
  ctx: Pick<BookingsContext, "orgId">,
  f: { from: string; days: number; resourceId?: string; status?: BookingStatus },
) {
  const s = await getBookingSettings(ctx)
  const start = zonedToUtc(f.from, 0, s.timeZone) ?? new Date(`${f.from}T00:00:00Z`)
  const end =
    zonedToUtc(addDays(f.from, f.days), 0, s.timeZone) ??
    new Date(`${addDays(f.from, f.days)}T00:00:00Z`)
  const where: SQL[] = [
    eq(booking.orgId, ctx.orgId),
    gte(booking.startsAt, start),
    lt(booking.startsAt, end),
  ]
  if (f.resourceId && isUuid(f.resourceId)) where.push(eq(booking.resourceId, f.resourceId))
  if (f.status) where.push(eq(booking.status, f.status))
  const rows = await db
    .select({
      id: booking.id,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      status: booking.status,
      source: booking.source,
      customerName: booking.customerName,
      customerPhone: booking.customerPhone,
      serviceName: bookingService.name,
      resourceId: booking.resourceId,
      resourceName: bookingResource.name,
    })
    .from(booking)
    .innerJoin(bookingService, eq(bookingService.id, booking.serviceId))
    .innerJoin(bookingResource, eq(bookingResource.id, booking.resourceId))
    .where(and(...where))
    .orderBy(asc(booking.startsAt))
    .limit(1000)
  return { rows, timeZone: s.timeZone }
}

export async function getBooking(ctx: Pick<BookingsContext, "orgId">, id: string) {
  if (!isUuid(id)) throw notFound()
  const [row] = await db
    .select({
      booking,
      serviceName: bookingService.name,
      priceCents: bookingService.priceCents,
      currency: bookingService.currency,
      resourceName: bookingResource.name,
      createdByName: user.name,
    })
    .from(booking)
    .innerJoin(bookingService, eq(bookingService.id, booking.serviceId))
    .innerJoin(bookingResource, eq(bookingResource.id, booking.resourceId))
    .leftJoin(user, eq(user.id, booking.createdBy))
    .where(and(eq(booking.id, id), eq(booking.orgId, ctx.orgId)))
  if (!row) throw notFound()
  const s = await getBookingSettings(ctx)
  return { ...row, timeZone: s.timeZone }
}

const TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["cancelled", "completed", "no_show"],
  cancelled: [],
  completed: [],
  no_show: [],
}

export async function setBookingStatus(
  ctx: BookingsContext,
  id: string,
  status: BookingStatus,
  reason?: string | null,
) {
  const { booking: b, serviceName, timeZone } = await getBooking(ctx, id)
  if (!TRANSITIONS[b.status].includes(status))
    throw conflict(
      `A ${b.status.replace("_", "-")} booking can't become ${status.replace("_", "-")}.`,
    )
  if ((status === "completed" || status === "no_show") && b.startsAt.getTime() > Date.now())
    throw conflict("You can mark it completed or a no-show once it has started.")
  const [row] = await db
    .update(booking)
    .set({
      status,
      cancelReason: status === "cancelled" ? reason?.trim().slice(0, 500) || null : b.cancelReason,
    })
    .where(and(eq(booking.id, id), eq(booking.orgId, ctx.orgId), eq(booking.status, b.status)))
    .returning()
  if (!row) throw conflict("Someone else just changed this booking. Refresh and try again.")
  if (status === "confirmed" && b.status === "pending") await emailCustomer(row, "confirmed")
  if (status === "cancelled") await emailCustomer(row, "cancelled")
  await audit(
    ctx,
    `booking.${status}`,
    `Marked ${serviceName} for ${b.customerName} (${formatDate(b.startsAt, timeZone)}) as ${status.replace("_", "-")}`,
    {
      target: { type: "booking", id },
    },
  )
  return row
}

export async function bookingSummary(ctx: Pick<BookingsContext, "orgId">) {
  const s = await getBookingSettings(ctx)
  const t = today(s.timeZone)
  const dayStart = zonedToUtc(t, 0, s.timeZone) ?? new Date()
  const dayEnd = zonedToUtc(addDays(t, 1), 0, s.timeZone) ?? new Date()
  const weekEnd = zonedToUtc(addDays(t, 7), 0, s.timeZone) ?? new Date()
  const [row] = await db
    .select({
      today: sql<number>`count(*) filter (where ${booking.startsAt} >= ${dayStart.toISOString()}::timestamptz and ${booking.startsAt} < ${dayEnd.toISOString()}::timestamptz and ${booking.status} in ('pending','confirmed'))::int`,
      week: sql<number>`count(*) filter (where ${booking.startsAt} >= ${dayStart.toISOString()}::timestamptz and ${booking.startsAt} < ${weekEnd.toISOString()}::timestamptz and ${booking.status} in ('pending','confirmed'))::int`,
      pending: sql<number>`count(*) filter (where ${booking.status} = 'pending' and ${booking.startsAt} > now())::int`,
    })
    .from(booking)
    .where(eq(booking.orgId, ctx.orgId))
  return { ...(row ?? { today: 0, week: 0, pending: 0 }), timeZone: s.timeZone, day: t }
}

// ---------- Messages ----------

async function notifyStaff(
  orgId: string,
  b: Booking,
  type: "booking.created" | "booking.cancelled",
  title: string,
) {
  const [res] = await db
    .select({ userId: bookingResource.userId })
    .from(bookingResource)
    .where(eq(bookingResource.id, b.resourceId))
  const to = res?.userId ? [res.userId] : await membersWithRole(orgId, ["owner", "admin"])
  await notify({
    orgId,
    to,
    type,
    title,
    body: `${b.customerName}${b.customerPhone ? ` · ${b.customerPhone}` : ""}`,
    link: `/bookings/${b.id}`,
  })
}

async function emailCustomer(b: Booking, why: "received" | "confirmed" | "cancelled") {
  if (!b.customerEmail) return
  const [info] = await db
    .select({ org: organization.name, service: bookingService.name, tz: bookingSettings.timeZone })
    .from(booking)
    .innerJoin(organization, eq(organization.id, booking.orgId))
    .innerJoin(bookingService, eq(bookingService.id, booking.serviceId))
    .innerJoin(bookingSettings, eq(bookingSettings.orgId, booking.orgId))
    .where(eq(booking.id, b.id))
  if (!info) return
  const when = `${formatDate(b.startsAt, info.tz)} at ${formatTime(b.startsAt, info.tz)}`
  const subject =
    why === "received"
      ? `Booking request received: ${info.service}`
      : why === "confirmed"
        ? `You're booked: ${info.service}, ${when}`
        : `Booking cancelled: ${info.service}, ${when}`
  try {
    await sendEmail({
      to: b.customerEmail,
      ...renderEmail({
        subject,
        heading: subject,
        paragraphs: [
          `Hi ${b.customerName},`,
          why === "received"
            ? `${info.org} has your request for ${when}. You'll get another email once it's confirmed.`
            : why === "confirmed"
              ? `See you ${when}.`
              : `Your booking for ${when} has been cancelled.`,
        ],
        action:
          why === "cancelled"
            ? undefined
            : { label: "View or cancel", url: appUrl(`/book/manage/${b.manageToken}`) },
        footer: `Sent by ${info.org}.`,
      }),
    })
  } catch (e) {
    console.error("[bookings] email failed", e)
  }
}
