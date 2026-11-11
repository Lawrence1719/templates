import {
  addTimeOff,
  availability,
  BOOKING_STATUSES,
  bookingSummary,
  bookOnline,
  cancelByToken,
  computeSlots,
  createBooking,
  getBooking,
  getBookingByToken,
  getBookingSettings,
  getPublicBookingPage,
  listBookings,
  ONLINE_RATE_LIMIT,
  publicAvailability,
  rotatePublicSlug,
  saveResource,
  saveService,
  setBookingStatus,
  setHours,
  updateBookingSettings,
  zonedToUtc,
} from "@templates/bookings"
import { db } from "@templates/db"
import { booking, BOOKING_STATUSES as DB_STATUSES } from "@templates/db/schema"
import { devOutbox, listNotifications } from "@templates/notifications"
import { describe, expect, it } from "vitest"

import { addMember, newOrgOwner } from "../setup/client"

type Person = { id: string; name: string; email: string }
const ctxOf = (orgId: string, u: Person) => ({
  orgId,
  user: { id: u.id, name: u.name, email: u.email },
})

const settingsInput = {
  timeZone: "Asia/Manila",
  slotMinutes: 30,
  minNoticeMinutes: 0,
  maxDaysAhead: 365,
  cancelNoticeMinutes: 60,
  requireApproval: false,
  publicEnabled: true,
}

/** A future weekday in Manila (UTC+8, no DST), far enough out to be bookable. */
const DAY = "2027-03-03" // Wednesday
const at = (hhmm: string, day = DAY) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number]
  return zonedToUtc(day, h * 60 + m, "Asia/Manila") as Date
}

async function setup() {
  const org = await newOrgOwner("Salon")
  const ctx = ctxOf(org.orgId, org)
  await updateBookingSettings(ctx, settingsInput)
  const ana = await saveResource(ctx, null, { name: "Ana", userId: org.id })
  const ben = await saveResource(ctx, null, { name: "Ben" })
  const cut = await saveService(ctx, null, {
    name: "Haircut",
    durationMinutes: 45,
    bufferMinutes: 15,
    price: "35",
    currency: "USD",
    resourceIds: [],
  })
  const settings = await getBookingSettings(ctx)
  return { org, ctx, ana, ben, cut, slug: settings.publicSlug }
}

const times = (slots: { startsAt: Date }[]) =>
  slots.map((s) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Manila",
      hour: "2-digit",
      minute: "2-digit",
    }).format(s.startsAt),
  )

describe("time zones and slots", () => {
  it("converts wall-clock times across daylight-saving changes", () => {
    // New York: clocks jump 02:00 → 03:00 on 2027-03-14 and fall back on 2027-11-07.
    expect(zonedToUtc("2027-03-13", 9 * 60, "America/New_York")?.toISOString()).toBe(
      "2027-03-13T14:00:00.000Z",
    )
    expect(zonedToUtc("2027-03-14", 9 * 60, "America/New_York")?.toISOString()).toBe(
      "2027-03-14T13:00:00.000Z",
    )
    expect(zonedToUtc("2027-03-14", 2 * 60 + 30, "America/New_York")).toBeNull() // doesn't exist
    expect(zonedToUtc("2027-11-07", 9 * 60, "America/New_York")?.toISOString()).toBe(
      "2027-11-07T14:00:00.000Z",
    )
    expect(zonedToUtc("2027-03-03", 9 * 60, "Asia/Manila")?.toISOString()).toBe(
      "2027-03-03T01:00:00.000Z",
    )
  })

  it("fits services into hours, around busy times, buffers and notice", () => {
    const day = "2027-03-03"
    const tz = "UTC"
    const slots = computeSlots({
      day,
      timeZone: tz,
      hours: [{ startMinute: 9 * 60, endMinute: 12 * 60 }],
      durationMinutes: 45,
      bufferMinutes: 15,
      stepMinutes: 30,
      busy: [{ start: new Date(`${day}T10:00:00Z`), end: new Date(`${day}T11:00:00Z`) }],
      now: new Date(`${day}T08:00:00Z`),
      minNoticeMinutes: 90,
      maxDaysAhead: 30,
    }).map((d) => d.toISOString().slice(11, 16))
    // 09:00 is inside the 90-minute notice; 09:30+45+15 would hit 10:00; 10:xx is busy.
    expect(slots).toEqual(["11:00"])
  })

  it("keeps status lists in sync between the module and the schema", () => {
    expect(BOOKING_STATUSES).toEqual(DB_STATUSES)
  })
})

describe("availability", () => {
  it("follows each person's hours and shows who is free", async () => {
    const s = await setup()
    await setHours(s.ctx, s.ben.id, [{ weekday: 3, start: "13:00", end: "15:00" }])
    const r = await availability(s.org.orgId, {
      serviceId: s.cut.id,
      resourceId: null,
      day: DAY,
      now: new Date("2027-01-01"),
    })
    expect(times(r.slots).slice(0, 2)).toEqual(["09:00", "09:30"])
    const at13 = r.slots.find((x) => x.startsAt.getTime() === at("13:00").getTime())
    expect(at13?.resourceIds.sort()).toEqual([s.ana.id, s.ben.id].sort())
    const benOnly = await availability(s.org.orgId, {
      serviceId: s.cut.id,
      resourceId: s.ben.id,
      day: DAY,
      now: new Date("2027-01-01"),
    })
    expect(times(benOnly.slots)).toEqual(["13:00", "13:30", "14:00"])
  })

  it("removes booked times (with buffer) and time off", async () => {
    const s = await setup()
    await createBooking(s.ctx, {
      serviceId: s.cut.id,
      resourceId: s.ana.id,
      startsAt: at("10:00").toISOString(),
      customerName: "Dana",
    })
    await addTimeOff(s.ctx, {
      resourceId: s.ana.id,
      startsAt: `${DAY}T14:00`,
      endsAt: `${DAY}T17:00`,
      reason: "Dentist",
    })
    const r = await availability(s.org.orgId, {
      serviceId: s.cut.id,
      resourceId: s.ana.id,
      day: DAY,
      now: new Date("2027-01-01"),
    })
    // 10:00 booked for 45 + 15 buffer → free again at 11:00; 09:30 would run into 10:00.
    expect(times(r.slots)).toEqual(["09:00", "11:00", "11:30", "12:00", "12:30", "13:00"])
  })

  it("only offers a service with the people who do it", async () => {
    const s = await setup()
    const color = await saveService(s.ctx, null, {
      name: "Color",
      durationMinutes: 90,
      bufferMinutes: 0,
      price: "80",
      currency: "USD",
      resourceIds: [s.ben.id],
    })
    const r = await availability(s.org.orgId, {
      serviceId: color.id,
      resourceId: s.ana.id,
      day: DAY,
      now: new Date("2027-01-01"),
    })
    expect(r.slots).toEqual([])
    await expect(
      createBooking(s.ctx, {
        serviceId: color.id,
        resourceId: s.ana.id,
        startsAt: at("09:00").toISOString(),
        customerName: "X",
      }),
    ).rejects.toMatchObject({ fieldErrors: { resourceId: "Color isn't offered by them" } })
  })
})

describe("no double booking", () => {
  it("is refused by the database, buffer included", async () => {
    const s = await setup()
    const b = { serviceId: s.cut.id, resourceId: s.ana.id, customerName: "A" }
    await createBooking(s.ctx, { ...b, startsAt: at("10:00").toISOString() })
    // 10:50 starts inside the first booking's 15-minute buffer (ends 10:45, busy until 11:00).
    await expect(
      createBooking(s.ctx, { ...b, startsAt: at("10:50").toISOString() }),
    ).rejects.toMatchObject({ status: 409 })
    // Another person at the same time is fine.
    await expect(
      createBooking(s.ctx, { ...b, resourceId: s.ben.id, startsAt: at("10:00").toISOString() }),
    ).resolves.toBeTruthy()
  })

  it("lets exactly one of many simultaneous requests win", async () => {
    const s = await setup()
    const tries = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        createBooking(s.ctx, {
          serviceId: s.cut.id,
          resourceId: s.ana.id,
          startsAt: at("15:00").toISOString(),
          customerName: `C${i}`,
        }),
      ),
    )
    expect(tries.filter((t) => t.status === "fulfilled")).toHaveLength(1)
  })

  it("frees the time again when a booking is cancelled", async () => {
    const s = await setup()
    const b = await createBooking(s.ctx, {
      serviceId: s.cut.id,
      resourceId: s.ana.id,
      startsAt: at("16:00").toISOString(),
      customerName: "A",
    })
    await setBookingStatus(s.ctx, b.id, "cancelled", "Sick")
    await expect(
      createBooking(s.ctx, {
        serviceId: s.cut.id,
        resourceId: s.ana.id,
        startsAt: at("16:00").toISOString(),
        customerName: "B",
      }),
    ).resolves.toBeTruthy()
  })
})

describe("online booking", () => {
  const online = (s: Awaited<ReturnType<typeof setup>>, hhmm: string, extra = {}) => ({
    serviceId: s.cut.id,
    resourceId: "any",
    startsAt: at(hhmm).toISOString(),
    customerName: "Rina",
    customerEmail: "rina@example.test",
    ...extra,
  })

  it("books a real free slot, emails the customer and tells the staff member", async () => {
    const s = await setup()
    const page = await getPublicBookingPage(s.slug)
    expect(page?.services.map((x) => x.name)).toEqual(["Haircut"])
    const pub = await publicAvailability(s.slug, {
      serviceId: s.cut.id,
      resourceId: "any",
      day: DAY,
    })
    expect(pub?.slots[0]).toBe(at("09:00").toISOString())

    const r = await bookOnline({
      slug: s.slug,
      data: online(s, "09:00", { resourceId: s.ana.id }),
      ip: "198.51.100.1",
    })
    expect(r.status).toBe("confirmed")
    const mail = devOutbox.filter((m) => m.to === "rina@example.test").at(-1)
    expect(mail?.subject).toContain("You're booked: Haircut")
    expect(mail?.html).toContain(`/book/manage/${r.token}`)
    const inbox = await listNotifications({ userId: s.org.id, orgId: s.org.orgId })
    expect(inbox.map((n) => n.type)).toContain("booking.created")
  })

  it("refuses times that aren't offered, and taken ones", async () => {
    const s = await setup()
    await expect(
      bookOnline({ slug: s.slug, data: online(s, "09:10"), ip: null }),
    ).rejects.toMatchObject({ status: 409 })
    await expect(
      bookOnline({ slug: s.slug, data: online(s, "20:00"), ip: null }),
    ).rejects.toMatchObject({ status: 409 })
    // "Anyone": two people book 09:00 — Ana and Ben both get one; a third is refused.
    await bookOnline({ slug: s.slug, data: online(s, "09:00"), ip: null })
    await bookOnline({ slug: s.slug, data: online(s, "09:00"), ip: null })
    await expect(
      bookOnline({ slug: s.slug, data: online(s, "09:00"), ip: null }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it("waits for approval when the business wants that", async () => {
    const s = await setup()
    await updateBookingSettings(s.ctx, { ...settingsInput, requireApproval: true })
    const r = await bookOnline({ slug: s.slug, data: online(s, "11:00"), ip: null })
    expect(r.status).toBe("pending")
    expect(devOutbox.filter((m) => m.to === "rina@example.test").at(-1)?.subject).toContain(
      "request received",
    )
    const found = await getBookingByToken(r.token ?? "")
    await setBookingStatus(s.ctx, found?.booking.id ?? "", "confirmed")
    expect(devOutbox.filter((m) => m.to === "rina@example.test").at(-1)?.subject).toContain(
      "You're booked",
    )
  })

  it("is off unless enabled, stops working with an old link, drops bots and rate-limits", async () => {
    const s = await setup()
    expect(await getPublicBookingPage("not-a-real-slug")).toBeNull()
    const bot = await bookOnline({
      slug: s.slug,
      data: online(s, "12:00"),
      honeypot: "http://spam",
      ip: null,
    })
    expect(bot.token).toBeNull()
    expect((await listBookings(s.ctx, { from: DAY, days: 1 })).rows).toHaveLength(0)

    for (let i = 0; i < ONLINE_RATE_LIMIT.max; i++) {
      await bookOnline({
        slug: s.slug,
        data: online(
          s,
          [
            "09:00",
            "09:00",
            "10:00",
            "10:00",
            "11:00",
            "11:00",
            "12:00",
            "12:00",
            "13:00",
            "13:00",
          ][i] ?? "14:00",
        ),
        ip: "203.0.113.9",
      })
    }
    await expect(
      bookOnline({ slug: s.slug, data: online(s, "15:00"), ip: "203.0.113.9" }),
    ).rejects.toMatchObject({ status: 429 })

    await rotatePublicSlug(s.ctx)
    expect(await getPublicBookingPage(s.slug)).toBeNull()
    await updateBookingSettings(s.ctx, { ...settingsInput, publicEnabled: false })
    const fresh = await getBookingSettings(s.ctx)
    expect(await getPublicBookingPage(fresh.publicSlug)).toBeNull()
  })

  it("lets the customer cancel by link until the cutoff, and tells staff", async () => {
    const s = await setup()
    const r = await bookOnline({
      slug: s.slug,
      data: online(s, "13:00", { resourceId: s.ana.id }),
      ip: null,
    })
    expect((await getBookingByToken(r.token ?? ""))?.canCancel).toBe(true)
    await cancelByToken(r.token ?? "", "Can't make it")
    await expect(cancelByToken(r.token ?? "")).rejects.toMatchObject({ status: 409 })
    const inbox = await listNotifications({ userId: s.org.id, orgId: s.org.orgId })
    expect(inbox.map((n) => n.type)).toContain("booking.cancelled")
    expect(await getBookingByToken("A".repeat(24))).toBeNull()
  })
})

describe("staff workflow", () => {
  it("moves through statuses in order and lists the agenda", async () => {
    const s = await setup()
    const rep = await addMember(s.org, "member")
    const repCtx = ctxOf(s.org.orgId, rep)
    const b = await createBooking(repCtx, {
      serviceId: s.cut.id,
      resourceId: s.ben.id,
      startsAt: at("09:00").toISOString(),
      customerName: "Lea",
    })
    await expect(setBookingStatus(repCtx, b.id, "completed")).rejects.toMatchObject({ status: 409 }) // hasn't started
    await setBookingStatus(repCtx, b.id, "cancelled", "Changed plans")
    await expect(setBookingStatus(repCtx, b.id, "confirmed")).rejects.toMatchObject({ status: 409 })
    expect((await getBooking(s.ctx, b.id)).booking.cancelReason).toBe("Changed plans")

    // A booking in the past can be completed.
    const past = await db
      .insert(booking)
      .values({
        orgId: s.org.orgId,
        serviceId: s.cut.id,
        resourceId: s.ana.id,
        customerName: "Old",
        startsAt: new Date("2026-01-05T02:00:00Z"),
        endsAt: new Date("2026-01-05T02:45:00Z"),
        blockedUntil: new Date("2026-01-05T03:00:00Z"),
        manageToken: "x".repeat(24),
      })
      .returning()
    await setBookingStatus(s.ctx, past[0]?.id ?? "", "completed")

    const agenda = await listBookings(s.ctx, { from: DAY, days: 1 })
    expect(agenda.rows.map((r) => r.customerName)).toEqual(["Lea"])
    const sum = await bookingSummary(s.ctx)
    expect(sum.pending).toBe(0)
  })
})

describe("org isolation", () => {
  it("can't see or touch another org's bookings, people or services", async () => {
    const a = await setup()
    const b = await setup()
    const bk = await createBooking(a.ctx, {
      serviceId: a.cut.id,
      resourceId: a.ana.id,
      startsAt: at("09:00").toISOString(),
      customerName: "A",
    })
    await expect(getBooking(b.ctx, bk.id)).rejects.toMatchObject({ status: 404 })
    await expect(setBookingStatus(b.ctx, bk.id, "cancelled")).rejects.toMatchObject({ status: 404 })
    await expect(
      createBooking(b.ctx, {
        serviceId: a.cut.id,
        resourceId: b.ana.id,
        startsAt: at("09:00").toISOString(),
        customerName: "X",
      }),
    ).rejects.toMatchObject({ fieldErrors: { serviceId: "Choose a service from the list" } })
    await expect(
      createBooking(b.ctx, {
        serviceId: b.cut.id,
        resourceId: a.ana.id,
        startsAt: at("09:00").toISOString(),
        customerName: "X",
      }),
    ).rejects.toMatchObject({ fieldErrors: { resourceId: "Choose from the list" } })
    await expect(
      saveService(b.ctx, null, {
        name: "Sneaky",
        durationMinutes: 30,
        bufferMinutes: 0,
        price: "1",
        currency: "USD",
        resourceIds: [a.ana.id],
      }),
    ).rejects.toMatchObject({
      fieldErrors: { resourceIds: "Choose from your own team and rooms" },
    })
    expect((await listBookings(b.ctx, { from: DAY, days: 1 })).rows).toHaveLength(0)
    // B's public page doesn't reveal A's services.
    expect((await getPublicBookingPage(b.slug))?.services.map((s) => s.id)).toEqual([b.cut.id])
  })
})

describe("permissions", () => {
  it.each([
    ["member", { booking: ["read", "write"] }, true],
    ["member", { booking: ["manage"] }, false],
    ["admin", { booking: ["manage"] }, true],
  ] as const)("%s → %j is %s", async (role, permissions, expected) => {
    const org = await newOrgOwner("Acme")
    const m = await addMember(org, role)
    expect(
      (await m.client.call("/organization/has-permission", { permissions })).data.success,
    ).toBe(expected)
  })
})
