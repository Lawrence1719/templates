import { db } from "@templates/db"
import { auditLog, leaveAdjustment, leaveRequest, timeEntry } from "@templates/db/schema"
import {
  addHoliday,
  addLeaveAdjustment,
  addTimeEntry,
  cancelLeave,
  clockIn,
  clockOut,
  countLeave,
  createEmployee,
  decideLeave,
  deleteEmployee,
  directory,
  type EmployeeInput,
  getEmployee,
  leaveBalances,
  leaveYearOf,
  leaveYearRange,
  listDepartments,
  listLeave,
  myClock,
  parseDays,
  recordLeave,
  requestLeave,
  saveDepartment,
  saveLeaveType,
  timesheet,
  timesheetCsv,
  updateEmployee,
  updateHrSettings,
  updateTimeEntry,
  whoIsOff,
  zonedTime,
} from "@templates/hr"
import { listNotifications } from "@templates/notifications"
import { and, eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { addMember, newOrgOwner } from "../setup/client"

type Person = { id: string; name: string; email: string }
const ctxOf = (orgId: string, u: Person) => ({
  orgId,
  user: { id: u.id, name: u.name, email: u.email },
})

const person = (extra: Partial<EmployeeInput> = {}): EmployeeInput => ({
  name: "Dana Cruz",
  employmentType: "full_time",
  startDate: "2025-03-01",
  ...extra,
})

async function setup() {
  const org = await newOrgOwner("Acme")
  const ctx = ctxOf(org.orgId, org)
  await updateHrSettings(ctx, {
    timeZone: "Asia/Manila",
    workDays: [1, 2, 3, 4, 5],
    leaveYearStartMonth: 1,
    weeklyHours: 40,
  })
  const staff = await addMember(org, "member")
  const sctx = ctxOf(org.orgId, staff)
  const [ops, vacation, unpaid] = await Promise.all([
    saveDepartment(ctx, null, { name: "Operations" }),
    saveLeaveType(ctx, null, { name: "Vacation", allowance: "6", paid: true }),
    saveLeaveType(ctx, null, { name: "Unpaid", allowance: "", paid: false }),
  ])
  const boss = await createEmployee(ctx, person({ name: "Owner Boss", userId: org.id }))
  const dana = await createEmployee(
    ctx,
    person({
      userId: staff.id,
      departmentId: ops.id,
      managerId: boss.id,
      jobTitle: "Barista",
      workEmail: "dana@acme.test",
      payType: "hourly",
      payRate: "6.50",
      payCurrency: "USD",
      birthDate: "1995-04-02",
      homeAddress: "12 Secret St",
      emergencyContactName: "Rob Cruz",
      emergencyContactPhone: "0917 000 0000",
    }),
  )
  return { org, ctx, staff, sctx, ops, vacation, unpaid, boss, dana }
}

describe("day math", () => {
  it("counts only work days that aren't holidays, in half days", () => {
    const opts = { workDays: [1, 2, 3, 4, 5], holidays: new Set(["2027-01-06"]) }
    // Mon 4 Jan to Sun 10 Jan 2027: five weekdays, one a holiday.
    expect(countLeave("2027-01-04", "2027-01-10", opts)).toBe(8)
    expect(countLeave("2027-01-09", "2027-01-10", opts)).toBe(0)
    expect(countLeave("2027-01-04", "2027-01-04", { ...opts, halfDay: true })).toBe(1)
    expect(leaveYearOf("2027-03-15", 4)).toBe(2026)
    expect(leaveYearRange(2026, 4)).toEqual({ start: "2026-04-01", end: "2027-03-31" })
    expect([
      parseDays("7.5"),
      parseDays("7.3"),
      parseDays("-1", { signed: true }),
      parseDays("-1"),
    ]).toEqual([15, null, -2, null])
  })

  it("turns wall-clock times into instants, and refuses times skipped by daylight saving", () => {
    expect(zonedTime("2026-11-02", "09:00", "Asia/Manila")?.toISOString()).toBe(
      "2026-11-02T01:00:00.000Z",
    )
    expect(zonedTime("2027-03-14", "02:30", "America/New_York")).toBeNull()
    expect(zonedTime("2027-03-14", "03:30", "America/New_York")?.toISOString()).toBe(
      "2027-03-14T07:30:00.000Z",
    )
  })
})

describe("employee records", () => {
  it("keeps pay and personal details private unless asked for by HR", async () => {
    const s = await setup()
    const open = await getEmployee(s.ctx, s.dana.id)
    expect(open.employee).not.toHaveProperty("payRateCents")
    expect(open.employee).not.toHaveProperty("homeAddress")
    expect(open.employee).not.toHaveProperty("emergencyContactPhone")
    expect(open).toMatchObject({
      department: { name: "Operations" },
      manager: { name: "Owner Boss" },
      account: { id: s.staff.id },
    })
    const full = await getEmployee(s.ctx, s.dana.id, { showPrivate: true })
    expect(full.employee).toMatchObject({ payRateCents: 650, homeAddress: "12 Secret St" })
    const dir = await directory(s.ctx)
    expect(Object.keys(dir.rows[0] ?? {}).sort()).toEqual(
      ["departmentName", "id", "jobTitle", "name", "phone", "workEmail"].sort(),
    )
    expect((await getEmployee(s.ctx, s.boss.id)).reports.map((r) => r.name)).toEqual(["Dana Cruz"])
    expect(await listDepartments(s.ctx)).toEqual([{ id: s.ops.id, name: "Operations", people: 1 }])

    // The audit log names the changed fields, never the private values.
    await updateEmployee(s.ctx, s.dana.id, {
      ...person({ userId: s.staff.id, departmentId: s.ops.id, managerId: s.boss.id }),
      payType: "hourly",
      payRate: "7.25",
      payCurrency: "USD",
      homeAddress: "99 New Rd",
    })
    const [entry] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.orgId, s.org.orgId), eq(auditLog.action, "employee.updated")))
    expect(JSON.stringify(entry?.metadata)).toContain("payRateCents")
    expect(JSON.stringify(entry?.metadata)).not.toContain("725")
    expect(JSON.stringify(entry?.metadata)).not.toContain("99 New Rd")
  })

  it("checks links: members only, one record per account, no loops in the reporting line", async () => {
    const s = await setup()
    const outsider = await newOrgOwner("Other")
    await expect(createEmployee(s.ctx, person({ userId: outsider.id }))).rejects.toMatchObject({
      fieldErrors: { userId: "Choose a member from the list" },
    })
    await expect(createEmployee(s.ctx, person({ userId: s.staff.id }))).rejects.toMatchObject({
      fieldErrors: { userId: "That account is already linked to someone else" },
    })
    const lead = await createEmployee(s.ctx, person({ name: "Lead", managerId: s.dana.id }))
    // Dana manages Lead, so Lead can't become Dana's manager.
    await expect(
      updateEmployee(s.ctx, s.dana.id, person({ userId: s.staff.id, managerId: lead.id })),
    ).rejects.toMatchObject({
      fieldErrors: { managerId: "They report to this person, so they can't be their manager" },
    })
    await expect(
      updateEmployee(s.ctx, s.dana.id, person({ userId: s.staff.id, managerId: s.dana.id })),
    ).rejects.toMatchObject({ fieldErrors: { managerId: "Someone can't manage themselves" } })
    await expect(createEmployee(s.ctx, person({ payRate: "10" }))).rejects.toMatchObject({
      fieldErrors: { payType: "Choose how and in what currency they're paid" },
    })
  })

  it("marks people as left instead of deleting their history", async () => {
    const s = await setup()
    await clockIn(s.sctx)
    await expect(
      updateEmployee(s.ctx, s.dana.id, person({ userId: s.staff.id, status: "left" })),
    ).rejects.toMatchObject({
      fieldErrors: { status: "They're still clocked in. Clock them out first." },
    })
    await clockOut(s.sctx)
    await expect(deleteEmployee(s.ctx, s.dana.id)).rejects.toMatchObject({ status: 409 })
    const gone = await updateEmployee(
      s.ctx,
      s.dana.id,
      person({ userId: s.staff.id, status: "left" }),
    )
    expect(gone.endDate).not.toBeNull()
    await expect(clockIn(s.sctx)).rejects.toMatchObject({ status: 403 })
    // A record added by mistake, with no history, can be deleted.
    const oops = await createEmployee(s.ctx, person({ name: "Typo" }))
    await expect(deleteEmployee(s.ctx, oops.id)).resolves.toBeUndefined()
  })
})

describe("time clock", () => {
  it("allows one open shift, even when clock-in is pressed many times at once", async () => {
    const s = await setup()
    const tries = await Promise.allSettled(
      Array.from({ length: 5 }, () => clockIn(s.sctx, "Opening")),
    )
    expect(tries.filter((t) => t.status === "fulfilled")).toHaveLength(1)
    const failed = tries.find((t) => t.status === "rejected") as PromiseRejectedResult
    expect(failed.reason).toMatchObject({ status: 409, message: "You're already clocked in." })
    const mine = await myClock(s.sctx)
    expect(mine?.open).not.toBeNull()
    const out = await clockOut(s.sctx, "Closed up")
    expect(out.note).toBe("Opening · Closed up")
    await expect(clockOut(s.sctx)).rejects.toMatchObject({ message: "You're not clocked in." })
    // Someone without an employee record can't use the clock.
    const stranger = await addMember(s.org, "member")
    await expect(clockIn(ctxOf(s.org.orgId, stranger))).rejects.toMatchObject({ status: 403 })
  })

  it("never lets entries overlap, records corrections, and totals the week with overtime", async () => {
    const s = await setup()
    await updateHrSettings(s.ctx, {
      timeZone: "Asia/Manila",
      workDays: [1, 2, 3, 4, 5],
      leaveYearStartMonth: 1,
      weeklyHours: 16,
    })
    const mon = await addTimeEntry(s.ctx, s.dana.id, {
      day: "2026-11-02",
      start: "09:00",
      end: "17:30",
    })
    await addTimeEntry(s.ctx, s.dana.id, {
      day: "2026-11-03",
      start: "22:00",
      end: "06:00",
      overnight: true,
      note: "=HYPERLINK(evil)",
    })
    await expect(
      addTimeEntry(s.ctx, s.dana.id, { day: "2026-11-02", start: "17:00", end: "18:00" }),
    ).rejects.toMatchObject({ fieldErrors: { start: "This overlaps another time entry" } })
    // The database refuses an overlap even when the app is bypassed.
    await expect(
      db.insert(timeEntry).values({
        orgId: s.org.orgId,
        employeeId: s.dana.id,
        clockIn: new Date("2026-11-02T02:00:00Z"),
        clockOut: new Date("2026-11-02T03:00:00Z"),
      }),
    ).rejects.toThrow()

    await updateTimeEntry(s.ctx, mon.id, { day: "2026-11-02", start: "09:00", end: "18:00" })
    const [corr] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.orgId, s.org.orgId), eq(auditLog.action, "time_entry.edited")))
    expect(corr?.metadata).toMatchObject({
      before: { clockOut: "2026-11-02T09:30:00.000Z" },
      after: { clockOut: "2026-11-02T10:00:00.000Z" },
    })

    const sheet = await timesheet(s.ctx, { week: "2026-11-05" })
    expect(sheet.weekStart).toBe("2026-11-02")
    const dana = sheet.people.find((p) => p.employeeId === s.dana.id)
    expect(dana?.days.slice(0, 3).map((d) => d.minutes)).toEqual([540, 480, 0])
    expect(dana).toMatchObject({ totalMinutes: 1020, overtimeMinutes: 60 })
    const csv = await timesheetCsv(s.ctx, "2026-11-02")
    expect(csv).toContain(`"'=HYPERLINK(evil)"`)
    expect(csv).toContain(`"2026-11-03","2026-11-03, 22:00","2026-11-04, 06:00","8.00"`)
  })
})

describe("leave", () => {
  it("counts working days, checks the balance including pending requests, and tells the manager", async () => {
    const s = await setup()
    await addHoliday(s.ctx, { day: "2027-01-06", name: "Three Kings" })
    const r = await requestLeave(s.sctx, {
      leaveTypeId: s.vacation.id,
      startDay: "2027-01-04",
      endDay: "2027-01-10",
      reason: "Family trip",
    })
    expect(r).toMatchObject({ status: "pending", halfDays: 8 })
    // 6 days allowed, 4 pending: 3 more is too many.
    await expect(
      requestLeave(s.sctx, {
        leaveTypeId: s.vacation.id,
        startDay: "2027-02-01",
        endDay: "2027-02-03",
      }),
    ).rejects.toMatchObject({
      fieldErrors: { endDay: "Only 2 days of vacation left after your pending requests" },
    })
    await expect(
      requestLeave(s.sctx, {
        leaveTypeId: s.vacation.id,
        startDay: "2027-01-08",
        endDay: "2027-01-08",
      }),
    ).rejects.toMatchObject({
      fieldErrors: { startDay: "There's already leave booked on some of those days" },
    })
    await expect(
      requestLeave(s.sctx, {
        leaveTypeId: s.vacation.id,
        startDay: "2027-01-09",
        endDay: "2027-01-10",
      }),
    ).rejects.toMatchObject({
      fieldErrors: { startDay: "There are no working days in those dates" },
    })
    await expect(
      requestLeave(s.sctx, {
        leaveTypeId: s.vacation.id,
        startDay: "2026-12-30",
        endDay: "2027-01-02",
      }),
    ).rejects.toMatchObject({
      fieldErrors: { endDay: "Split this at the start of the leave year (2027-01-01)" },
    })
    // Untracked leave has no limit.
    await expect(
      requestLeave(s.sctx, {
        leaveTypeId: s.unpaid.id,
        startDay: "2027-03-01",
        endDay: "2027-03-31",
      }),
    ).resolves.toMatchObject({ halfDays: 46 })

    const inbox = await listNotifications({ userId: s.org.id, orgId: s.org.orgId })
    expect(inbox.map((n) => n.title)).toContain("Dana Cruz asked for 4 days of vacation")
  })

  it("can't be overdrawn by requests sent at the same moment", async () => {
    const s = await setup()
    // Three 3-day requests against 6 days: only two fit.
    const weeks = ["2027-02-01", "2027-02-08", "2027-02-15"]
    const tries = await Promise.allSettled(
      weeks.map((w) =>
        requestLeave(s.sctx, {
          leaveTypeId: s.vacation.id,
          startDay: w,
          endDay: `2027-02-${String(Number(w.slice(8)) + 2).padStart(2, "0")}`,
        }),
      ),
    )
    expect(tries.filter((t) => t.status === "fulfilled")).toHaveLength(2)
    const b = await leaveBalances(s.ctx, s.dana.id, 2027)
    expect(b.types.find((t) => t.type.name === "Vacation")).toMatchObject({
      pendingHalfDays: 12,
      remainingHalfDays: 12,
    })
  })

  it("is approved by someone else, re-checked on approval, and can be topped up", async () => {
    const s = await setup()
    const a = await requestLeave(s.sctx, {
      leaveTypeId: s.vacation.id,
      startDay: "2027-02-01",
      endDay: "2027-02-05",
    })
    // HR records two days straight away, so the pending request no longer fits.
    await recordLeave(s.ctx, s.dana.id, {
      leaveTypeId: s.vacation.id,
      startDay: "2027-01-11",
      endDay: "2027-01-12",
    })
    await expect(decideLeave(s.ctx, a.id, { approve: true })).rejects.toMatchObject({
      status: 409,
      message:
        "Dana Cruz only has 4 days of vacation left. Add an adjustment first if they're allowed more.",
    })
    await addLeaveAdjustment(s.ctx, s.dana.id, {
      leaveTypeId: s.vacation.id,
      year: 2027,
      days: "1",
      reason: "Carried over",
    })
    const ok = await decideLeave(s.ctx, a.id, { approve: true, note: "Enjoy" })
    expect(ok.status).toBe("approved")
    await expect(decideLeave(s.ctx, a.id, { approve: false })).rejects.toMatchObject({
      status: 409,
    })
    const inbox = await listNotifications({ userId: s.staff.id, orgId: s.org.orgId })
    expect(inbox.map((n) => n.title)).toContain("Your vacation from 2027-02-01 was approved")
    const b = await leaveBalances(s.ctx, s.dana.id, 2027)
    expect(b.types.find((t) => t.type.name === "Vacation")).toMatchObject({
      allowanceHalfDays: 12,
      adjustmentHalfDays: 2,
      takenHalfDays: 14,
      remainingHalfDays: 0,
    })

    // Nobody approves their own request, owners included.
    const own = await addMember(s.org, "admin")
    const ownEmp = await createEmployee(s.ctx, person({ name: "Ada Admin", userId: own.id }))
    const actx = ctxOf(s.org.orgId, own)
    const mine = await requestLeave(actx, {
      leaveTypeId: s.unpaid.id,
      startDay: "2027-04-05",
      endDay: "2027-04-05",
    })
    await expect(decideLeave(actx, mine.id, { approve: true })).rejects.toMatchObject({
      status: 403,
    })
    expect(ownEmp.id).toBeTruthy()
  })

  it("lets people cancel what hasn't started, and keeps decisions final in the database", async () => {
    const s = await setup()
    const future = await recordLeave(s.ctx, s.dana.id, {
      leaveTypeId: s.unpaid.id,
      startDay: "2027-05-03",
      endDay: "2027-05-04",
    })
    const past = await recordLeave(s.ctx, s.dana.id, {
      leaveTypeId: s.unpaid.id,
      startDay: "2026-11-02",
      endDay: "2026-11-02",
    })
    await expect(cancelLeave(s.sctx, past.id)).rejects.toMatchObject({
      message: "This leave has started. Ask HR to change it.",
    })
    await expect(cancelLeave(s.sctx, future.id)).resolves.toMatchObject({ status: "cancelled" })
    const bossInbox = await listNotifications({ userId: s.org.id, orgId: s.org.orgId })
    expect(bossInbox.map((n) => n.title)).toContain(
      "Dana Cruz cancelled 2 days of unpaid from 2027-05-03",
    )
    await expect(cancelLeave(s.ctx, past.id, { asManager: true })).resolves.toMatchObject({
      status: "cancelled",
    })

    // Someone else's request isn't visible to cancel.
    const other = await addMember(s.org, "member")
    await createEmployee(s.ctx, person({ name: "Other", userId: other.id }))
    const r = await requestLeave(s.sctx, {
      leaveTypeId: s.unpaid.id,
      startDay: "2027-06-07",
      endDay: "2027-06-07",
    })
    await expect(cancelLeave(ctxOf(s.org.orgId, other), r.id)).rejects.toMatchObject({
      status: 404,
    })

    await expect(
      db.update(leaveRequest).set({ status: "approved" }).where(eq(leaveRequest.id, future.id)),
    ).rejects.toThrow()
    await decideLeave(s.ctx, r.id, { approve: true })
    await expect(
      db.update(leaveRequest).set({ endDay: "2027-06-30" }).where(eq(leaveRequest.id, r.id)),
    ).rejects.toThrow()
    await expect(db.delete(leaveRequest).where(eq(leaveRequest.id, r.id))).rejects.toThrow()
    const adj = await addLeaveAdjustment(s.ctx, s.dana.id, {
      leaveTypeId: s.vacation.id,
      year: 2027,
      days: "2",
      reason: "Bonus",
    })
    await expect(
      db
        .update(leaveAdjustment)
        .set({ halfDays: 100 })
        .where(eq(leaveAdjustment.id, adj?.id as string)),
    ).rejects.toThrow()

    const off = await whoIsOff(s.ctx, "2027-06-01", "2027-06-30")
    expect(off).toEqual([
      {
        employeeId: s.dana.id,
        name: "Dana Cruz",
        startDay: "2027-06-07",
        endDay: "2027-06-07",
        halfDay: false,
      },
    ])
    expect(Object.keys(off[0] ?? {})).not.toContain("typeName")
  })
})

describe("tenancy", () => {
  it("can't see or use another org's people, departments or leave types", async () => {
    const a = await setup()
    const b = await setup()
    await expect(getEmployee(b.ctx, a.dana.id)).rejects.toMatchObject({ status: 404 })
    await expect(
      createEmployee(b.ctx, person({ departmentId: a.ops.id, managerId: a.boss.id })),
    ).rejects.toMatchObject({
      fieldErrors: {
        departmentId: "Choose a department from the list",
        managerId: "Choose a manager from the list",
      },
    })
    await expect(
      requestLeave(b.sctx, {
        leaveTypeId: a.vacation.id,
        startDay: "2027-01-04",
        endDay: "2027-01-04",
      }),
    ).rejects.toMatchObject({
      fieldErrors: { leaveTypeId: "Choose the kind of leave from the list" },
    })
    await expect(
      addTimeEntry(b.ctx, a.dana.id, { day: "2026-11-02", start: "09:00", end: "10:00" }),
    ).rejects.toMatchObject({ status: 404 })
    await addTimeEntry(a.ctx, a.dana.id, { day: "2026-11-02", start: "09:00", end: "10:00" })
    expect((await timesheet(b.ctx, { week: "2026-11-02" })).people).toHaveLength(0)
    expect((await listLeave(b.ctx)).every((r) => r.employeeId !== a.dana.id)).toBe(true)
    expect((await directory(b.ctx)).rows.map((r) => r.name).sort()).toEqual([
      "Dana Cruz",
      "Owner Boss",
    ])
    expect((await directory(b.ctx)).rows.find((r) => r.id === a.dana.id)).toBeUndefined()
  })
})

describe("permissions", () => {
  it.each([
    ["member", { hr: ["self"] }, true],
    ["member", { hr: ["read"] }, false],
    ["member", { hr: ["approve"] }, false],
    ["admin", { hr: ["read", "approve", "manage"] }, true],
  ] as const)("%s → %j is %s", async (role, permissions, expected) => {
    const org = await newOrgOwner("Acme")
    const m = await addMember(org, role)
    expect(
      (await m.client.call("/organization/has-permission", { permissions })).data.success,
    ).toBe(expected)
  })
})
