import { createCustomer } from "@templates/crm"
import { db } from "@templates/db"
import { membership, membershipCheckIn, membershipPeriod, organization } from "@templates/db/schema"
import { getInvoice } from "@templates/invoicing"
import {
  addDays,
  cancelMembership,
  checkIn,
  formatCardCode,
  getMemberCard,
  getMembership,
  listMemberships,
  membershipState,
  membershipSummary,
  nextPeriodStart,
  pauseMembership,
  periodEndFor,
  renewMembership,
  replaceCard,
  resumeMembership,
  runMembershipJobs,
  savePlan,
  startMembership,
  today,
  updateMembershipSettings,
  voidCheckIn,
} from "@templates/memberships"
import { eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { addMember, newOrgOwner } from "../setup/client"

type Person = { id: string; name: string; email: string }
const ctxOf = (orgId: string, u: Person) => ({
  orgId,
  user: { id: u.id, name: u.name, email: u.email },
})

const TZ = "Asia/Manila"
const T = () => today(TZ)

async function setup() {
  const org = await newOrgOwner("Gym")
  const ctx = ctxOf(org.orgId, org)
  await updateMembershipSettings(ctx, { timeZone: TZ, checkInCooldownMinutes: 60, reminderDays: 7 })
  const [ana, monthly, pack] = await Promise.all([
    createCustomer(ctx, {
      kind: "person",
      name: "Ana Reyes",
      email: "ana@example.test",
      status: "active",
    }),
    savePlan(ctx, null, {
      name: "Monthly",
      price: "49",
      currency: "USD",
      periodUnit: "month",
      periodCount: 1,
    }),
    savePlan(ctx, null, {
      name: "10-class pack",
      price: "120",
      currency: "USD",
      periodUnit: "month",
      periodCount: 3,
      visitLimit: "2",
    }),
  ])
  return { org, ctx, ana, monthly, pack }
}

type S = Awaited<ReturnType<typeof setup>>
const start = (s: S, planId: string, extra: Record<string, unknown> = {}) =>
  startMembership(s.ctx, { customerId: s.ana.id, planId, startDay: T(), paidVia: "cash", ...extra })

describe("period math", () => {
  it("works out period ends, renewals and state", () => {
    expect(periodEndFor("2027-01-15", { periodUnit: "month", periodCount: 1 })).toBe("2027-02-14")
    expect(periodEndFor("2027-01-31", { periodUnit: "month", periodCount: 1 })).toBe("2027-02-27")
    expect(periodEndFor("2027-01-01", { periodUnit: "week", periodCount: 2 })).toBe("2027-01-14")
    expect(periodEndFor("2027-02-10", { periodUnit: "year", periodCount: 1 })).toBe("2028-02-09")
    expect(nextPeriodStart("2027-02-14", "2027-02-01")).toBe("2027-02-15")
    expect(nextPeriodStart("2027-02-14", "2027-03-01")).toBe("2027-03-01")
    const m = { status: "active" as const, periodStart: "2027-01-01", periodEnd: "2027-01-31" }
    expect(membershipState(m, "2027-01-10")).toBe("active")
    expect(membershipState(m, "2027-01-28")).toBe("expiring")
    expect(membershipState(m, "2027-02-01")).toBe("expired")
    expect(membershipState(m, "2026-12-30")).toBe("upcoming")
    expect(formatCardCode("ABCDEFGH")).toBe("ABCD-EFGH")
  })
})

describe("signing up and checking in", () => {
  it("checks in by card code however it's typed, and refuses a double scan", async () => {
    const s = await setup()
    const m = await start(s, s.monthly.id)
    expect(m.cardToken).toMatch(/^[2-9A-HJ-NP-Z]{24}$/)
    expect(m.periodEnd).toBe(addDays(periodEndFor(T(), { periodUnit: "month", periodCount: 1 }), 0))
    const typed = formatCardCode(m.cardToken).toLowerCase()
    const first = await checkIn(s.ctx, { code: typed })
    expect(first).toMatchObject({
      ok: true,
      memberName: "Ana Reyes",
      planName: "Monthly",
      visitsLeft: null,
    })
    // Five scans at once right after: all refused by the cooldown, none counted.
    const again = await Promise.all(
      Array.from({ length: 5 }, () => checkIn(s.ctx, { code: m.cardToken })),
    )
    expect(again.every((r) => !r.ok && r.reason.startsWith("Already checked in at"))).toBe(true)
    expect((await getMembership(s.ctx, m.id)).visitsUsed).toBe(1)
    expect(await checkIn(s.ctx, { code: "nope" })).toMatchObject({
      ok: false,
      reason: "That doesn't look like a card code.",
    })
    expect(await checkIn(s.ctx, { code: "Z".repeat(24) })).toMatchObject({ ok: false })
  })

  it("counts visits against the plan's limit, even when scans arrive together", async () => {
    const s = await setup()
    await updateMembershipSettings(s.ctx, {
      timeZone: TZ,
      checkInCooldownMinutes: 0,
      reminderDays: 7,
    })
    const m = await start(s, s.pack.id)
    const all = await Promise.all(
      Array.from({ length: 4 }, () => checkIn(s.ctx, { membershipId: m.id })),
    )
    expect(all.filter((r) => r.ok)).toHaveLength(2)
    expect(all.find((r) => !r.ok)).toMatchObject({
      reason: "No visits left this period (2 of 2 used). Renew to add more.",
    })
    // Undoing a mistaken check-in gives the visit back.
    const okOne = all.find((r) => r.ok)
    if (!okOne?.ok) throw new Error("no check-in")
    await voidCheckIn(s.ctx, okOne.checkInId)
    await expect(voidCheckIn(s.ctx, okOne.checkInId)).rejects.toMatchObject({ status: 409 })
    expect(await checkIn(s.ctx, { membershipId: m.id })).toMatchObject({ ok: true, visitsLeft: 0 })
  })

  it("lets staff undo only their own recent check-ins", async () => {
    const s = await setup()
    const desk = await addMember(s.org, "member")
    const other = await addMember(s.org, "member")
    const m = await start(s, s.monthly.id)
    const r = await checkIn(ctxOf(s.org.orgId, desk), { membershipId: m.id })
    if (!r.ok) throw new Error(r.reason)
    await expect(voidCheckIn(ctxOf(s.org.orgId, other), r.checkInId)).rejects.toMatchObject({
      status: 403,
    })
    await expect(voidCheckIn(ctxOf(s.org.orgId, desk), r.checkInId)).resolves.toBeUndefined()
  })

  it("refuses memberships that haven't started, have expired, are paused or cancelled", async () => {
    const s = await setup()
    const later = await start(s, s.monthly.id, { startDay: addDays(T(), 3) })
    expect(await checkIn(s.ctx, { membershipId: later.id })).toMatchObject({ ok: false })
    const old = await start(s, s.monthly.id, { startDay: addDays(T(), -31) })
    const lapsed = await getMembership(s.ctx, old.id)
    expect(lapsed.state).toBe("expired")
    expect((await checkIn(s.ctx, { membershipId: old.id })) as { reason: string }).toMatchObject({
      reason: expect.stringMatching(/^Expired on /),
    })
    await expect(
      startMembership(s.ctx, {
        customerId: s.ana.id,
        planId: s.monthly.id,
        startDay: addDays(T(), -40),
        paidVia: "cash",
      }),
    ).rejects.toMatchObject({ fieldErrors: { startDay: "Can't start more than a month ago" } })
  })
})

describe("renewing, pausing and cancelling", () => {
  it("renews from the end of the period, once, even with double clicks", async () => {
    const s = await setup()
    const m = await start(s, s.monthly.id)
    const tries = await Promise.allSettled(
      Array.from({ length: 3 }, () =>
        renewMembership(s.ctx, m.id, { paidVia: "card", expectedPeriodEnd: m.periodEnd }),
      ),
    )
    expect(tries.filter((t) => t.status === "fulfilled")).toHaveLength(1)
    const after = await getMembership(s.ctx, m.id)
    expect(after.membership.periodStart).toBe(addDays(m.periodEnd, 1))
    expect(after.periods).toHaveLength(2)
    // A price change applies from the next renewal.
    await savePlan(s.ctx, s.monthly.id, {
      name: "Monthly",
      price: "55",
      currency: "USD",
      periodUnit: "month",
      periodCount: 1,
    })
    const r2 = await renewMembership(s.ctx, m.id, {
      paidVia: "invoice",
      expectedPeriodEnd: after.membership.periodEnd,
    })
    const periods = (await getMembership(s.ctx, m.id)).periods
    expect(periods.map((p) => p.priceCents)).toEqual([5500, 4900, 4900])
    const inv = await getInvoice(s.ctx, periods[0]?.invoiceId as string)
    expect(inv.invoice).toMatchObject({ status: "draft", totalCents: 5500, customerId: s.ana.id })
    expect(r2.periodStart).toBe(addDays(after.membership.periodEnd, 1))
  })

  it("restarts a lapsed membership from today", async () => {
    const s = await setup()
    const m = await start(s, s.monthly.id, { startDay: addDays(T(), -31) })
    const r = await renewMembership(s.ctx, m.id, {
      paidVia: "cash",
      expectedPeriodEnd: m.periodEnd,
    })
    expect(r.periodStart).toBe(T())
  })

  it("adds paused days back when it resumes, and refuses visits while paused", async () => {
    const s = await setup()
    const m = await start(s, s.monthly.id)
    await pauseMembership(s.ctx, m.id)
    expect(await checkIn(s.ctx, { membershipId: m.id })).toMatchObject({ ok: false })
    await expect(
      renewMembership(s.ctx, m.id, { paidVia: "cash", expectedPeriodEnd: m.periodEnd }),
    ).rejects.toMatchObject({
      message: "Resume the membership before renewing it.",
    })
    // Pretend it was paused 10 days ago.
    await db
      .update(membership)
      .set({ pausedOn: addDays(T(), -10) })
      .where(eq(membership.id, m.id))
    const r = await resumeMembership(s.ctx, m.id)
    expect(r.periodEnd).toBe(addDays(m.periodEnd, 10))
    expect(r.status).toBe("active")
  })

  it("keeps cancelled memberships final, even in the database", async () => {
    const s = await setup()
    const m = await start(s, s.monthly.id)
    await cancelMembership(s.ctx, m.id, "Moved away")
    expect(await checkIn(s.ctx, { code: m.cardToken })).toMatchObject({
      ok: false,
      reason: "This membership is cancelled.",
    })
    await expect(
      renewMembership(s.ctx, m.id, { paidVia: "cash", expectedPeriodEnd: m.periodEnd }),
    ).rejects.toMatchObject({
      status: 409,
    })
    await expect(
      db.update(membership).set({ status: "active" }).where(eq(membership.id, m.id)),
    ).rejects.toThrow()
    await expect(db.delete(membership).where(eq(membership.id, m.id))).rejects.toThrow()
    await expect(
      db
        .update(membershipPeriod)
        .set({ priceCents: 1 })
        .where(eq(membershipPeriod.membershipId, m.id)),
    ).rejects.toThrow()
  })
})

describe("the member's card", () => {
  it("shows only the member's own status, and a replaced card stops working", async () => {
    const s = await setup()
    const m = await start(s, s.pack.id)
    expect(await getMemberCard(formatCardCode(m.cardToken))).toMatchObject({
      orgName: "Gym",
      memberName: "Ana Reyes",
      planName: "10-class pack",
      state: "active",
      visitsLeft: 2,
    })
    const fresh = await replaceCard(s.ctx, m.id)
    expect(fresh.cardToken).not.toBe(m.cardToken)
    expect(await getMemberCard(m.cardToken)).toBeNull()
    expect(await checkIn(s.ctx, { code: m.cardToken })).toMatchObject({ ok: false })
    expect(await getMemberCard("short")).toBeNull()
  })
})

describe("scheduled jobs", () => {
  it("auto-renews lapsed memberships once and reminds once per period", async () => {
    const s = await setup()
    const lapsed = await start(s, s.monthly.id, { startDay: addDays(T(), -31), autoRenew: true })
    // Ends in 5 days: gets a reminder.
    const soon = await start(s, s.monthly.id, { startDay: addDays(T(), -26) })
    const first = await runMembershipJobs({ orgId: s.org.orgId })
    expect(first).toMatchObject({ renewed: 1, reminded: 1, failed: 0 })
    const renewed = await getMembership(s.ctx, lapsed.id)
    expect(renewed.membership.periodStart).toBe(T())
    expect(renewed.periods[0]?.paidVia).toBe("invoice")
    expect((await getMembership(s.ctx, soon.id)).membership.remindedFor).toBe(soon.periodEnd)
    expect(await runMembershipJobs({ orgId: s.org.orgId })).toMatchObject({
      renewed: 0,
      reminded: 0,
    })
    expect(await membershipSummary(s.ctx)).toMatchObject({ active: 2, expiring: 1 })
    expect((await listMemberships(s.ctx, { state: "expiring" })).rows.map((r) => r.id)).toEqual([
      soon.id,
    ])
  })
})

describe("records can't be rewritten", () => {
  it("keeps check-ins and history append-only, and goes with the organization", async () => {
    const s = await setup()
    const m = await start(s, s.monthly.id)
    const r = await checkIn(s.ctx, { membershipId: m.id })
    if (!r.ok) throw new Error(r.reason)
    await expect(
      db.delete(membershipCheckIn).where(eq(membershipCheckIn.id, r.checkInId)),
    ).rejects.toThrow()
    await expect(
      db
        .update(membershipCheckIn)
        .set({ checkedInAt: new Date(0) })
        .where(eq(membershipCheckIn.id, r.checkInId)),
    ).rejects.toThrow()
    await db.delete(organization).where(eq(organization.id, s.org.orgId))
    expect(
      await db.select().from(membership).where(eq(membership.orgId, s.org.orgId)),
    ).toHaveLength(0)
  })
})

describe("tenancy", () => {
  it("can't see, check in or sell with another org's members, plans or customers", async () => {
    const a = await setup()
    const b = await setup()
    const m = await start(a, a.monthly.id)
    expect(await checkIn(b.ctx, { code: m.cardToken })).toMatchObject({
      ok: false,
      reason: "No membership has that card code. It may have been replaced.",
    })
    await expect(checkIn(b.ctx, { membershipId: m.id })).rejects.toMatchObject({ status: 404 })
    await expect(getMembership(b.ctx, m.id)).rejects.toMatchObject({ status: 404 })
    await expect(
      startMembership(b.ctx, {
        customerId: a.ana.id,
        planId: a.monthly.id,
        startDay: T(),
        paidVia: "cash",
      }),
    ).rejects.toMatchObject({
      fieldErrors: {
        customerId: "Choose a customer from the list",
        planId: "Choose a plan from the list",
      },
    })
    expect((await listMemberships(b.ctx)).rows).toHaveLength(0)
    expect(await runMembershipJobs({ orgId: b.org.orgId })).toMatchObject({ renewed: 0 })
  })
})

describe("permissions", () => {
  it.each([
    ["member", { membership: ["read", "checkin", "sell"] }, true],
    ["member", { membership: ["manage"] }, false],
    ["admin", { membership: ["manage"] }, true],
  ] as const)("%s → %j is %s", async (role, permissions, expected) => {
    const org = await newOrgOwner("Gym")
    const m = await addMember(org, role)
    expect(
      (await m.client.call("/organization/has-permission", { permissions })).data.success,
    ).toBe(expected)
  })
})
