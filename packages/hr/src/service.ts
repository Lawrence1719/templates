import "server-only"

import { audit } from "@templates/audit"
import { db } from "@templates/db"
import {
  type Employee,
  employee,
  hrDepartment,
  hrHoliday,
  hrSettings,
  leaveAdjustment,
  leaveRequest,
  leaveType,
  member,
  timeEntry,
  user,
} from "@templates/db/schema"
import { membersWithRole, notify } from "@templates/notifications"
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { z } from "zod"

import {
  type AdjustmentInput,
  addDays,
  adjustmentInputSchema,
  countLeave,
  type DepartmentInput,
  decisionSchema,
  departmentInputSchema,
  type EmployeeFilter,
  type EmployeeInput,
  employeeFilterSchema,
  employeeInputSchema,
  fieldErrors,
  formatDays,
  type HolidayInput,
  holidayInputSchema,
  isDay,
  type LeaveRequestInput,
  type LeaveTypeInput,
  leaveRequestSchema,
  leaveTypeInputSchema,
  leaveYearOf,
  leaveYearRange,
  PRIVATE_FIELDS,
  type SettingsInput,
  settingsInputSchema,
  type TimeEntryInput,
  timeEntryInputSchema,
  today,
  weekStart,
  zonedTime,
} from "./definitions"

export type HrContext = { orgId: string; user: { id: string; name: string; email: string } }

export class HrError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(message)
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Org = Pick<HrContext, "orgId">

const isUuid = (s: string) => z.uuid().safeParse(s).success
const notFound = () => new HrError("Not found", 404)
const conflict = (m: string) => new HrError(m, 409)
const forbidden = (m: string) => new HrError(m, 403)
const invalid = (fe: Record<string, string>) =>
  new HrError("Please fix the highlighted fields.", 400, fe)

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input)
  if (!r.success) throw invalid(fieldErrors(r.error))
  return r.data
}

const pgCode = (e: unknown): string | undefined => {
  const err = e as { code?: string; cause?: unknown } | null
  return err?.code ?? (err?.cause ? pgCode(err.cause) : undefined)
}

const likeTerm = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

// ---------- Settings ----------

export async function getHrSettings(ctx: Org) {
  await db.insert(hrSettings).values({ orgId: ctx.orgId }).onConflictDoNothing()
  const [s] = await db.select().from(hrSettings).where(eq(hrSettings.orgId, ctx.orgId))
  if (!s) throw new Error("hr settings missing")
  return s
}

export async function updateHrSettings(ctx: HrContext, input: SettingsInput) {
  const v = parse(settingsInputSchema, input)
  await getHrSettings(ctx)
  await db
    .update(hrSettings)
    .set({
      timeZone: v.timeZone,
      workDays: v.workDays,
      leaveYearStartMonth: v.leaveYearStartMonth,
      weeklyHours: v.weeklyHours,
    })
    .where(eq(hrSettings.orgId, ctx.orgId))
  await audit(ctx, "hr_settings.updated", "Updated HR settings", { metadata: v })
}

// ---------- Departments, leave types, holidays ----------

export async function listDepartments(ctx: Org) {
  return db
    .select({
      id: hrDepartment.id,
      name: hrDepartment.name,
      people: sql<number>`count(${employee.id})::int`.mapWith(Number),
    })
    .from(hrDepartment)
    .leftJoin(
      employee,
      and(eq(employee.departmentId, hrDepartment.id), eq(employee.status, "active")),
    )
    .where(eq(hrDepartment.orgId, ctx.orgId))
    .groupBy(hrDepartment.id)
    .orderBy(asc(hrDepartment.name))
}

export async function saveDepartment(ctx: HrContext, id: string | null, input: DepartmentInput) {
  const v = parse(departmentInputSchema, input)
  try {
    if (id) {
      if (!isUuid(id)) throw notFound()
      const [row] = await db
        .update(hrDepartment)
        .set({ name: v.name })
        .where(and(eq(hrDepartment.id, id), eq(hrDepartment.orgId, ctx.orgId)))
        .returning()
      if (!row) throw notFound()
      return row
    }
    const [row] = await db
      .insert(hrDepartment)
      .values({ orgId: ctx.orgId, name: v.name })
      .returning()
    if (!row) throw new Error("insert failed")
    await audit(ctx, "hr_department.created", `Added department ${v.name}`)
    return row
  } catch (e) {
    if (pgCode(e) === "23505")
      throw invalid({ name: "You already have a department with this name" })
    throw e
  }
}

export async function deleteDepartment(ctx: HrContext, id: string) {
  if (!isUuid(id)) throw notFound()
  try {
    const [row] = await db
      .delete(hrDepartment)
      .where(and(eq(hrDepartment.id, id), eq(hrDepartment.orgId, ctx.orgId)))
      .returning()
    if (!row) throw notFound()
    await audit(ctx, "hr_department.deleted", `Deleted department ${row.name}`)
  } catch (e) {
    if (pgCode(e) === "23503") throw conflict("Move everyone out of this department first.")
    throw e
  }
}

export async function listLeaveTypes(ctx: Org, opts: { includeArchived?: boolean } = {}) {
  return db
    .select()
    .from(leaveType)
    .where(
      and(
        eq(leaveType.orgId, ctx.orgId),
        opts.includeArchived ? undefined : eq(leaveType.status, "active"),
      ),
    )
    .orderBy(asc(leaveType.status), asc(leaveType.name))
}

export async function saveLeaveType(ctx: HrContext, id: string | null, input: LeaveTypeInput) {
  const v = parse(leaveTypeInputSchema, input)
  const values = { name: v.name, allowanceHalfDays: v.allowance, paid: v.paid }
  try {
    if (id) {
      if (!isUuid(id)) throw notFound()
      const [row] = await db
        .update(leaveType)
        .set(values)
        .where(and(eq(leaveType.id, id), eq(leaveType.orgId, ctx.orgId)))
        .returning()
      if (!row) throw notFound()
      await audit(ctx, "leave_type.updated", `Updated leave type ${v.name}`, { metadata: values })
      return row
    }
    const [row] = await db
      .insert(leaveType)
      .values({ orgId: ctx.orgId, ...values })
      .returning()
    if (!row) throw new Error("insert failed")
    await audit(ctx, "leave_type.created", `Added leave type ${v.name}`, { metadata: values })
    return row
  } catch (e) {
    if (pgCode(e) === "23505")
      throw invalid({ name: "You already have a leave type with this name" })
    throw e
  }
}

export async function setLeaveTypeStatus(
  ctx: HrContext,
  id: string,
  status: "active" | "archived",
) {
  if (!isUuid(id)) throw notFound()
  const [row] = await db
    .update(leaveType)
    .set({ status })
    .where(and(eq(leaveType.id, id), eq(leaveType.orgId, ctx.orgId)))
    .returning()
  if (!row) throw notFound()
}

export async function listHolidays(ctx: Org, range?: { from: string; to: string }) {
  return db
    .select()
    .from(hrHoliday)
    .where(
      and(
        eq(hrHoliday.orgId, ctx.orgId),
        range ? gte(hrHoliday.day, range.from) : undefined,
        range ? lte(hrHoliday.day, range.to) : undefined,
      ),
    )
    .orderBy(asc(hrHoliday.day))
}

export async function addHoliday(ctx: HrContext, input: HolidayInput) {
  const v = parse(holidayInputSchema, input)
  try {
    const [row] = await db
      .insert(hrHoliday)
      .values({ orgId: ctx.orgId, ...v })
      .returning()
    await audit(ctx, "hr_holiday.created", `Added holiday ${v.name} on ${v.day}`)
    return row
  } catch (e) {
    if (pgCode(e) === "23505") throw invalid({ day: "There's already a holiday on this day" })
    throw e
  }
}

export async function deleteHoliday(ctx: HrContext, id: string) {
  if (!isUuid(id)) throw notFound()
  const [row] = await db
    .delete(hrHoliday)
    .where(and(eq(hrHoliday.id, id), eq(hrHoliday.orgId, ctx.orgId)))
    .returning()
  if (!row) throw notFound()
}

// ---------- Employees ----------

async function ownEmployee(ctx: Org, id: string, t: Tx | typeof db = db) {
  if (!isUuid(id)) throw notFound()
  const [e] = await t
    .select()
    .from(employee)
    .where(and(eq(employee.id, id), eq(employee.orgId, ctx.orgId)))
  if (!e) throw notFound()
  return e
}

/** The employee record linked to the signed-in user, if any. */
export async function myEmployee(ctx: HrContext) {
  const [e] = await db
    .select()
    .from(employee)
    .where(and(eq(employee.orgId, ctx.orgId), eq(employee.userId, ctx.user.id)))
  return e ?? null
}

async function requireMe(ctx: HrContext) {
  const me = await myEmployee(ctx)
  if (!me)
    throw forbidden("Your account isn't linked to an employee record yet. Ask HR to link it.")
  if (me.status !== "active") throw forbidden("Your employee record is marked as left.")
  return me
}

function stripPrivate<T extends Partial<Employee>>(e: T) {
  const out = { ...e }
  for (const k of PRIVATE_FIELDS) delete out[k]
  return out as Omit<T, (typeof PRIVATE_FIELDS)[number]>
}

async function checkEmployeeRefs(
  ctx: Org,
  id: string | null,
  v: z.output<typeof employeeInputSchema>,
) {
  const errors: Record<string, string> = {}
  if (v.userId) {
    const [m] = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, ctx.orgId), eq(member.userId, v.userId)))
    if (!m) errors.userId = "Choose a member from the list"
  }
  if (v.departmentId) {
    const [d] = await db
      .select({ id: hrDepartment.id })
      .from(hrDepartment)
      .where(and(eq(hrDepartment.id, v.departmentId), eq(hrDepartment.orgId, ctx.orgId)))
    if (!d) errors.departmentId = "Choose a department from the list"
  }
  if (v.managerId) {
    if (v.managerId === id) errors.managerId = "Someone can't manage themselves"
    else {
      const [m] = await db
        .select({ status: employee.status })
        .from(employee)
        .where(and(eq(employee.id, v.managerId), eq(employee.orgId, ctx.orgId)))
      if (!m) errors.managerId = "Choose a manager from the list"
      else if (m.status !== "active") errors.managerId = "That person has left"
      else if (id && (await managesIndirectly(ctx, id, v.managerId)))
        errors.managerId = "They report to this person, so they can't be their manager"
    }
  }
  if (Object.keys(errors).length) throw invalid(errors)
}

/** True if `personId` is somewhere above `candidate` in the reporting line. */
async function managesIndirectly(ctx: Org, personId: string, candidate: string) {
  const rows = await db.execute<{ id: string }>(sql`
    with recursive chain(id, manager_id, depth) as (
      select id, manager_id, 0 from ${employee} where id = ${candidate} and org_id = ${ctx.orgId}
      union all
      select e.id, e.manager_id, c.depth + 1 from ${employee} e
        join chain c on e.id = c.manager_id
        where e.org_id = ${ctx.orgId} and c.depth < 100
    )
    select id from chain where id = ${personId} limit 1`)
  return rows.length > 0
}

function employeeValues(v: z.output<typeof employeeInputSchema>) {
  return {
    name: v.name,
    userId: v.userId,
    workEmail: v.workEmail,
    phone: v.phone,
    jobTitle: v.jobTitle,
    departmentId: v.departmentId,
    managerId: v.managerId,
    employmentType: v.employmentType,
    startDate: v.startDate,
    endDate: v.endDate,
    status: v.status,
    payType: v.payType,
    payRateCents: v.payRate,
    payCurrency: v.payCurrency,
    birthDate: v.birthDate,
    homeAddress: v.homeAddress,
    emergencyContactName: v.emergencyContactName,
    emergencyContactPhone: v.emergencyContactPhone,
    privateNotes: v.privateNotes,
  }
}

const linkTaken = (e: unknown) =>
  pgCode(e) === "23505" ? invalid({ userId: "That account is already linked to someone else" }) : e

export async function createEmployee(ctx: HrContext, input: EmployeeInput) {
  const v = parse(employeeInputSchema, input)
  await checkEmployeeRefs(ctx, null, v)
  try {
    const [row] = await db
      .insert(employee)
      .values({ orgId: ctx.orgId, ...employeeValues(v) })
      .returning()
    if (!row) throw new Error("insert failed")
    await audit(ctx, "employee.created", `Added employee ${row.name}`, {
      target: { type: "employee", id: row.id },
    })
    return row
  } catch (e) {
    throw linkTaken(e)
  }
}

export async function updateEmployee(ctx: HrContext, id: string, input: EmployeeInput) {
  const before = await ownEmployee(ctx, id)
  const v = parse(employeeInputSchema, input)
  await checkEmployeeRefs(ctx, id, v)
  const values = employeeValues(v)
  if (values.status === "left") {
    values.endDate ??= today((await getHrSettings(ctx)).timeZone)
    const [open] = await db
      .select({ id: timeEntry.id })
      .from(timeEntry)
      .where(and(eq(timeEntry.employeeId, id), isNull(timeEntry.clockOut)))
    if (open) throw invalid({ status: "They're still clocked in. Clock them out first." })
  }
  try {
    const [row] = await db
      .update(employee)
      .set(values)
      .where(and(eq(employee.id, id), eq(employee.orgId, ctx.orgId)))
      .returning()
    if (!row) throw notFound()
    // Record which fields changed, never the private values themselves.
    const changed = (Object.keys(values) as (keyof typeof values)[]).filter(
      (k) => String(before[k] ?? "") !== String(values[k] ?? ""),
    )
    if (changed.length)
      await audit(ctx, "employee.updated", `Updated employee ${row.name}`, {
        target: { type: "employee", id },
        metadata: { fields: changed },
      })
    if (before.status !== row.status)
      await audit(
        ctx,
        row.status === "left" ? "employee.left" : "employee.rejoined",
        row.status === "left"
          ? `${row.name} left on ${row.endDate}`
          : `${row.name} is active again`,
        { target: { type: "employee", id } },
      )
    return row
  } catch (e) {
    throw linkTaken(e)
  }
}

/** Only for records added by mistake: anyone with history is marked as left instead. */
export async function deleteEmployee(ctx: HrContext, id: string) {
  const e = await ownEmployee(ctx, id)
  const [[entries], [decided], [reports]] = await Promise.all([
    db.select({ n: count() }).from(timeEntry).where(eq(timeEntry.employeeId, id)),
    db
      .select({ n: count() })
      .from(leaveRequest)
      .where(and(eq(leaveRequest.employeeId, id), ne(leaveRequest.status, "pending"))),
    db.select({ n: count() }).from(employee).where(eq(employee.managerId, id)),
  ])
  if ((entries?.n ?? 0) > 0 || (decided?.n ?? 0) > 0)
    throw conflict("They have time or leave on record. Mark them as left instead.")
  if ((reports?.n ?? 0) > 0)
    throw conflict("Give the people who report to them a new manager first.")
  await db.delete(employee).where(and(eq(employee.id, id), eq(employee.orgId, ctx.orgId)))
  await audit(ctx, "employee.deleted", `Deleted employee record ${e.name}`, {
    target: { type: "employee", id },
  })
}

const manager = alias(employee, "manager")

/**
 * One employee. Private fields (pay, birthday, home address, emergency
 * contact, notes) are removed unless `showPrivate` is set.
 */
export async function getEmployee(ctx: Org, id: string, opts: { showPrivate?: boolean } = {}) {
  const e = await ownEmployee(ctx, id)
  const [dept, mgr, reports, account] = await Promise.all([
    e.departmentId
      ? db
          .select({ id: hrDepartment.id, name: hrDepartment.name })
          .from(hrDepartment)
          .where(eq(hrDepartment.id, e.departmentId))
          .then((r) => r[0] ?? null)
      : null,
    e.managerId
      ? db
          .select({ id: employee.id, name: employee.name })
          .from(employee)
          .where(eq(employee.id, e.managerId))
          .then((r) => r[0] ?? null)
      : null,
    db
      .select({ id: employee.id, name: employee.name, jobTitle: employee.jobTitle })
      .from(employee)
      .where(and(eq(employee.managerId, id), eq(employee.status, "active")))
      .orderBy(asc(employee.name)),
    e.userId
      ? db
          .select({ id: user.id, name: user.name, email: user.email })
          .from(user)
          .where(eq(user.id, e.userId))
          .then((r) => r[0] ?? null)
      : null,
  ])
  const record = opts.showPrivate ? e : stripPrivate(e)
  return { employee: record as typeof e, department: dept, manager: mgr, reports, account }
}

export async function listEmployees(ctx: Org, f: EmployeeFilter = {}) {
  const filter = employeeFilterSchema.parse(f)
  const where: SQL[] = [eq(employee.orgId, ctx.orgId)]
  where.push(eq(employee.status, filter.status ?? "active"))
  if (filter.department) where.push(eq(employee.departmentId, filter.department))
  if (filter.q) {
    const t = likeTerm(filter.q)
    const s = or(ilike(employee.name, t), ilike(employee.jobTitle, t), ilike(employee.workEmail, t))
    if (s) where.push(s)
  }
  const rows = await db
    .select({
      id: employee.id,
      name: employee.name,
      jobTitle: employee.jobTitle,
      workEmail: employee.workEmail,
      phone: employee.phone,
      employmentType: employee.employmentType,
      startDate: employee.startDate,
      endDate: employee.endDate,
      status: employee.status,
      linked: sql<boolean>`${employee.userId} is not null`,
      departmentId: employee.departmentId,
      departmentName: hrDepartment.name,
      managerName: manager.name,
    })
    .from(employee)
    .leftJoin(hrDepartment, eq(hrDepartment.id, employee.departmentId))
    .leftJoin(manager, eq(manager.id, employee.managerId))
    .where(and(...where))
    .orderBy(asc(employee.name))
    .limit(2000)
  return { rows, filter }
}

/** What everyone can see about colleagues: name, role, department and work contact. */
export async function directory(ctx: Org, f: EmployeeFilter = {}) {
  const { rows, filter } = await listEmployees(ctx, { ...f, status: "active" })
  return {
    rows: rows.map((r) => ({
      id: r.id,
      name: r.name,
      jobTitle: r.jobTitle,
      workEmail: r.workEmail,
      phone: r.phone,
      departmentName: r.departmentName,
    })),
    filter,
  }
}

/** Org members, marking those already linked to an employee record. */
export async function memberOptions(ctx: Org) {
  return db
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      employeeId: employee.id,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .leftJoin(employee, and(eq(employee.userId, user.id), eq(employee.orgId, ctx.orgId)))
    .where(eq(member.organizationId, ctx.orgId))
    .orderBy(asc(user.name))
}

// ---------- Time clock ----------

const overlapError = (e: unknown, field = "start") => {
  if (pgCode(e) === "23P01") return invalid({ [field]: "This overlaps another time entry" })
  if (pgCode(e) === "23505")
    return invalid({ end: "They already have an open entry. Close it first." })
  return e
}

export async function clockIn(ctx: HrContext, note?: string | null) {
  const me = await requireMe(ctx)
  const n = (note ?? "").trim().slice(0, 300) || null
  try {
    const [row] = await db
      .insert(timeEntry)
      .values({
        orgId: ctx.orgId,
        employeeId: me.id,
        clockIn: new Date(),
        note: n,
        createdBy: ctx.user.id,
      })
      .returning()
    return row
  } catch (e) {
    if (pgCode(e) === "23505" || pgCode(e) === "23P01") throw conflict("You're already clocked in.")
    throw e
  }
}

export async function clockOut(ctx: HrContext, note?: string | null) {
  const me = await requireMe(ctx)
  const n = (note ?? "").trim().slice(0, 300)
  const [row] = await db
    .update(timeEntry)
    .set({
      clockOut: sql`greatest(now(), ${timeEntry.clockIn} + interval '1 second')`,
      ...(n ? { note: sql`coalesce(${timeEntry.note} || ' · ', '') || ${n}` } : {}),
    })
    .where(and(eq(timeEntry.employeeId, me.id), isNull(timeEntry.clockOut)))
    .returning()
  if (!row) throw conflict("You're not clocked in.")
  return row
}

const minutesOf = (from: Date, to: Date | null, now = new Date()) =>
  Math.max(0, Math.floor(((to ?? now).getTime() - from.getTime()) / 60_000))

/** The signed-in person's clock: open entry and hours today and this week. */
export async function myClock(ctx: HrContext) {
  const me = await myEmployee(ctx)
  if (!me) return null
  const settings = await getHrSettings(ctx)
  const day = today(settings.timeZone)
  const sheet = await timesheet(ctx, { week: day, employeeIds: [me.id] })
  const mine = sheet.people[0]
  const [open] = await db
    .select()
    .from(timeEntry)
    .where(and(eq(timeEntry.employeeId, me.id), isNull(timeEntry.clockOut)))
  return {
    employee: stripPrivate(me),
    open: open ?? null,
    todayMinutes: mine?.days.find((d) => d.day === day)?.minutes ?? 0,
    weekMinutes: mine?.totalMinutes ?? 0,
    entries: mine?.entries ?? [],
    timeZone: settings.timeZone,
  }
}

function entryTimes(v: z.output<typeof timeEntryInputSchema>, timeZone: string) {
  const start = zonedTime(v.day, v.start, timeZone)
  if (!start) throw invalid({ start: "That time doesn't exist on this day (clock change)" })
  let end: Date | null = null
  if (v.end) {
    end = zonedTime(v.overnight ? addDays(v.day, 1) : v.day, v.end, timeZone)
    if (!end) throw invalid({ end: "That time doesn't exist on this day (clock change)" })
    if (end <= start) throw invalid({ end: "Must be after the start" })
    if (end.getTime() - start.getTime() > 24 * 3_600_000)
      throw invalid({ end: "Keep an entry under 24 hours" })
  }
  if (start.getTime() > Date.now() + 60_000) throw invalid({ start: "Can't be in the future" })
  return { start, end }
}

/** HR adds time for someone (a forgotten clock-in, a paper timesheet). */
export async function addTimeEntry(ctx: HrContext, employeeId: string, input: TimeEntryInput) {
  const e = await ownEmployee(ctx, employeeId)
  const v = parse(timeEntryInputSchema, input)
  const { start, end } = entryTimes(v, (await getHrSettings(ctx)).timeZone)
  try {
    const [row] = await db
      .insert(timeEntry)
      .values({
        orgId: ctx.orgId,
        employeeId,
        clockIn: start,
        clockOut: end,
        note: v.note,
        source: "manual",
        createdBy: ctx.user.id,
      })
      .returning()
    if (!row) throw new Error("insert failed")
    await audit(ctx, "time_entry.added", `Added time for ${e.name}`, {
      target: { type: "employee", id: employeeId },
      metadata: { entryId: row.id, clockIn: start, clockOut: end },
    })
    return row
  } catch (err) {
    throw overlapError(err)
  }
}

async function ownEntry(ctx: Org, id: string) {
  if (!isUuid(id)) throw notFound()
  const [row] = await db
    .select()
    .from(timeEntry)
    .where(and(eq(timeEntry.id, id), eq(timeEntry.orgId, ctx.orgId)))
  if (!row) throw notFound()
  return row
}

/** HR corrects an entry. The audit log keeps the times before and after. */
export async function updateTimeEntry(ctx: HrContext, id: string, input: TimeEntryInput) {
  const before = await ownEntry(ctx, id)
  const v = parse(timeEntryInputSchema, input)
  const { start, end } = entryTimes(v, (await getHrSettings(ctx)).timeZone)
  try {
    const [row] = await db
      .update(timeEntry)
      .set({
        clockIn: start,
        clockOut: end,
        note: v.note,
        editedBy: ctx.user.id,
        editedAt: new Date(),
      })
      .where(and(eq(timeEntry.id, id), eq(timeEntry.orgId, ctx.orgId)))
      .returning()
    const [e] = await db
      .select({ name: employee.name })
      .from(employee)
      .where(eq(employee.id, before.employeeId))
    await audit(ctx, "time_entry.edited", `Corrected time for ${e?.name ?? "an employee"}`, {
      target: { type: "employee", id: before.employeeId },
      metadata: {
        entryId: id,
        before: { clockIn: before.clockIn, clockOut: before.clockOut },
        after: { clockIn: start, clockOut: end },
      },
    })
    return row
  } catch (err) {
    throw overlapError(err)
  }
}

export async function deleteTimeEntry(ctx: HrContext, id: string) {
  const before = await ownEntry(ctx, id)
  await db.delete(timeEntry).where(and(eq(timeEntry.id, id), eq(timeEntry.orgId, ctx.orgId)))
  const [e] = await db
    .select({ name: employee.name })
    .from(employee)
    .where(eq(employee.id, before.employeeId))
  await audit(ctx, "time_entry.deleted", `Deleted a time entry for ${e?.name ?? "an employee"}`, {
    target: { type: "employee", id: before.employeeId },
    metadata: { clockIn: before.clockIn, clockOut: before.clockOut },
  })
}

/**
 * A week of clocked time (Monday to Sunday in the org's zone). Each entry
 * counts on the day it started; open entries count up to now. Time over the
 * weekly hours setting is overtime.
 */
export async function timesheet(ctx: Org, opts: { week?: string; employeeIds?: string[] } = {}) {
  const settings = await getHrSettings(ctx)
  const start = weekStart(opts.week && isDay(opts.week) ? opts.week : today(settings.timeZone))
  const end = addDays(start, 7)
  const tz = settings.timeZone
  const where: SQL[] = [
    eq(timeEntry.orgId, ctx.orgId),
    sql`${timeEntry.clockIn} >= ((${start})::date)::timestamp at time zone ${tz}`,
    sql`${timeEntry.clockIn} < ((${end})::date)::timestamp at time zone ${tz}`,
  ]
  const people = opts.employeeIds ? opts.employeeIds.filter(isUuid) : undefined
  if (people) where.push(people.length ? inArray(timeEntry.employeeId, people) : sql`false`)
  const rows = await db
    .select({
      id: timeEntry.id,
      employeeId: timeEntry.employeeId,
      name: employee.name,
      clockIn: timeEntry.clockIn,
      clockOut: timeEntry.clockOut,
      note: timeEntry.note,
      source: timeEntry.source,
      editedAt: timeEntry.editedAt,
      day: sql<string>`to_char(${timeEntry.clockIn} at time zone ${tz}, 'YYYY-MM-DD')`,
    })
    .from(timeEntry)
    .innerJoin(employee, eq(employee.id, timeEntry.employeeId))
    .where(and(...where))
    .orderBy(asc(employee.name), asc(timeEntry.clockIn))
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  const now = new Date()
  const byPerson = new Map<
    string,
    { employeeId: string; name: string; entries: ((typeof rows)[number] & { minutes: number })[] }
  >()
  for (const r of rows) {
    const p = byPerson.get(r.employeeId) ?? { employeeId: r.employeeId, name: r.name, entries: [] }
    p.entries.push({ ...r, minutes: minutesOf(r.clockIn, r.clockOut, now) })
    byPerson.set(r.employeeId, p)
  }
  const overtimeAfter = settings.weeklyHours * 60
  return {
    weekStart: start,
    days,
    timeZone: tz,
    weeklyHours: settings.weeklyHours,
    people: [...byPerson.values()].map((p) => {
      const total = p.entries.reduce((n, e) => n + e.minutes, 0)
      return {
        ...p,
        days: days.map((d) => ({
          day: d,
          minutes: p.entries.filter((e) => e.day === d).reduce((n, e) => n + e.minutes, 0),
        })),
        totalMinutes: total,
        overtimeMinutes: Math.max(0, total - overtimeAfter),
        open: p.entries.some((e) => !e.clockOut),
      }
    }),
  }
}

const csvCell = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? "" : String(v)
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return `"${safe.replace(/"/g, '""')}"`
}

/** A week's entries as CSV for payroll (formula-safe). */
export async function timesheetCsv(ctx: Org, week?: string) {
  const sheet = await timesheet(ctx, { week })
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: sheet.timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
  const head = ["employee", "day", "clock_in", "clock_out", "hours", "source", "note"]
  const lines = [head.map(csvCell).join(",")]
  for (const p of sheet.people)
    for (const e of p.entries)
      lines.push(
        [
          p.name,
          e.day,
          fmt.format(e.clockIn),
          e.clockOut ? fmt.format(e.clockOut) : "open",
          (e.minutes / 60).toFixed(2),
          e.source,
          e.note,
        ]
          .map(csvCell)
          .join(","),
      )
  return lines.join("\n")
}

// ---------- Leave ----------

async function holidaySet(ctx: Org, from: string, to: string, t: Tx | typeof db = db) {
  const rows = await t
    .select({ day: hrHoliday.day })
    .from(hrHoliday)
    .where(and(eq(hrHoliday.orgId, ctx.orgId), gte(hrHoliday.day, from), lte(hrHoliday.day, to)))
  return new Set(rows.map((r) => r.day))
}

/** Allowance, adjustments, taken and pending for one person, type and leave year. */
async function balanceFor(
  t: Tx | typeof db,
  ctx: Org,
  employeeId: string,
  type: { id: string; allowanceHalfDays: number | null },
  year: number,
  startMonth: number,
) {
  const range = leaveYearRange(year, startMonth)
  const [[used], [adj]] = await Promise.all([
    t
      .select({
        approved: sql<number>`coalesce(sum(${leaveRequest.halfDays}) filter (where ${leaveRequest.status} = 'approved'), 0)::int`,
        pending: sql<number>`coalesce(sum(${leaveRequest.halfDays}) filter (where ${leaveRequest.status} = 'pending'), 0)::int`,
      })
      .from(leaveRequest)
      .where(
        and(
          eq(leaveRequest.orgId, ctx.orgId),
          eq(leaveRequest.employeeId, employeeId),
          eq(leaveRequest.leaveTypeId, type.id),
          gte(leaveRequest.startDay, range.start),
          lte(leaveRequest.startDay, range.end),
        ),
      ),
    t
      .select({ n: sql<number>`coalesce(sum(${leaveAdjustment.halfDays}), 0)::int` })
      .from(leaveAdjustment)
      .where(
        and(
          eq(leaveAdjustment.orgId, ctx.orgId),
          eq(leaveAdjustment.employeeId, employeeId),
          eq(leaveAdjustment.leaveTypeId, type.id),
          eq(leaveAdjustment.year, year),
        ),
      ),
  ])
  const tracked = type.allowanceHalfDays !== null
  const entitled = (type.allowanceHalfDays ?? 0) + (adj?.n ?? 0)
  const approved = used?.approved ?? 0
  const pending = used?.pending ?? 0
  return {
    tracked,
    allowanceHalfDays: type.allowanceHalfDays,
    adjustmentHalfDays: adj?.n ?? 0,
    takenHalfDays: approved,
    pendingHalfDays: pending,
    /** What's left after approved leave; pending requests still count against it when asking. */
    remainingHalfDays: tracked ? entitled - approved : null,
  }
}

export async function leaveBalances(ctx: Org, employeeId: string, year?: number) {
  await ownEmployee(ctx, employeeId)
  const settings = await getHrSettings(ctx)
  const y = year ?? leaveYearOf(today(settings.timeZone), settings.leaveYearStartMonth)
  const types = await listLeaveTypes(ctx)
  return {
    year: y,
    startMonth: settings.leaveYearStartMonth,
    types: await Promise.all(
      types.map(async (t) => ({
        type: { id: t.id, name: t.name, paid: t.paid },
        ...(await balanceFor(db, ctx, employeeId, t, y, settings.leaveYearStartMonth)),
      })),
    ),
  }
}

async function prepareLeave(ctx: Org, employeeId: string, input: LeaveRequestInput) {
  const v = parse(leaveRequestSchema, input)
  const [settings, [type]] = await Promise.all([
    getHrSettings(ctx),
    db
      .select()
      .from(leaveType)
      .where(and(eq(leaveType.id, v.leaveTypeId), eq(leaveType.orgId, ctx.orgId))),
  ])
  if (!type) throw invalid({ leaveTypeId: "Choose the kind of leave from the list" })
  if (type.status !== "active")
    throw invalid({ leaveTypeId: "That kind of leave is no longer offered" })
  const year = leaveYearOf(v.startDay, settings.leaveYearStartMonth)
  if (leaveYearOf(v.endDay, settings.leaveYearStartMonth) !== year) {
    const next = leaveYearRange(year + 1, settings.leaveYearStartMonth).start
    throw invalid({ endDay: `Split this at the start of the leave year (${next})` })
  }
  const holidays = await holidaySet(ctx, v.startDay, v.endDay)
  const halfDays = countLeave(v.startDay, v.endDay, {
    workDays: settings.workDays,
    holidays,
    halfDay: v.halfDay,
  })
  if (halfDays === 0) throw invalid({ startDay: "There are no working days in those dates" })
  return { v, type, year, halfDays, settings, employeeId }
}

/** Locks the employee row so balance checks and approvals happen one at a time per person. */
async function lockEmployee(tx: Tx, ctx: Org, id: string) {
  const [e] = await tx
    .select()
    .from(employee)
    .where(and(eq(employee.id, id), eq(employee.orgId, ctx.orgId)))
    .for("update")
  if (!e) throw notFound()
  return e
}

const overlapLeave = (e: unknown) =>
  pgCode(e) === "23P01"
    ? invalid({ startDay: "There's already leave booked on some of those days" })
    : e

/** Who hears about a request: the person's manager if they have an account, otherwise owners and admins. */
async function approversFor(ctx: Org, e: Employee, exclude: string) {
  if (e.managerId) {
    const [m] = await db
      .select({ userId: employee.userId, status: employee.status })
      .from(employee)
      .where(eq(employee.id, e.managerId))
    if (m?.userId && m.status === "active" && m.userId !== exclude) return [m.userId]
  }
  return (await membersWithRole(ctx.orgId, ["owner", "admin"])).filter((u) => u !== exclude)
}

/** The signed-in person asks for leave. It waits for approval. */
export async function requestLeave(ctx: HrContext, input: LeaveRequestInput) {
  const me = await requireMe(ctx)
  const p = await prepareLeave(ctx, me.id, input)
  const row = await db
    .transaction(async (tx) => {
      await lockEmployee(tx, ctx, me.id)
      const b = await balanceFor(tx, ctx, me.id, p.type, p.year, p.settings.leaveYearStartMonth)
      if (b.tracked) {
        const left = (b.remainingHalfDays ?? 0) - b.pendingHalfDays
        if (p.halfDays > left)
          throw invalid({
            endDay:
              left <= 0
                ? `No ${p.type.name.toLowerCase()} left this year${b.pendingHalfDays ? " after your pending requests" : ""}`
                : `Only ${formatDays(left)} of ${p.type.name.toLowerCase()} left${b.pendingHalfDays ? " after your pending requests" : ""}`,
          })
      }
      const [r] = await tx
        .insert(leaveRequest)
        .values({
          orgId: ctx.orgId,
          employeeId: me.id,
          leaveTypeId: p.type.id,
          startDay: p.v.startDay,
          endDay: p.v.endDay,
          halfDay: p.v.halfDay,
          halfDays: p.halfDays,
          reason: p.v.reason,
          createdBy: ctx.user.id,
        })
        .returning()
      if (!r) throw new Error("insert failed")
      return r
    })
    .catch((e) => {
      throw overlapLeave(e)
    })
  await notify({
    orgId: ctx.orgId,
    to: await approversFor(ctx, me, ctx.user.id),
    type: "leave.requested",
    title: `${me.name} asked for ${formatDays(p.halfDays)} of ${p.type.name.toLowerCase()}`,
    body: `${p.v.startDay}${p.v.endDay !== p.v.startDay ? ` to ${p.v.endDay}` : ""}${p.v.reason ? `: ${p.v.reason}` : ""}`,
    link: "/hr/leave",
  })
  return row
}

/** HR records leave for someone directly, already approved (a phone call, a sick day). */
export async function recordLeave(ctx: HrContext, employeeId: string, input: LeaveRequestInput) {
  const e = await ownEmployee(ctx, employeeId)
  if (e.status !== "active") throw conflict(`${e.name} has left.`)
  const p = await prepareLeave(ctx, employeeId, input)
  const row = await db
    .transaction(async (tx) => {
      await lockEmployee(tx, ctx, employeeId)
      const b = await balanceFor(
        tx,
        ctx,
        employeeId,
        p.type,
        p.year,
        p.settings.leaveYearStartMonth,
      )
      if (b.tracked && p.halfDays > (b.remainingHalfDays ?? 0))
        throw invalid({
          endDay: `Only ${formatDays(Math.max(0, b.remainingHalfDays ?? 0))} left. Add an adjustment first if they're allowed more.`,
        })
      const [r] = await tx
        .insert(leaveRequest)
        .values({
          orgId: ctx.orgId,
          employeeId,
          leaveTypeId: p.type.id,
          startDay: p.v.startDay,
          endDay: p.v.endDay,
          halfDay: p.v.halfDay,
          halfDays: p.halfDays,
          reason: p.v.reason,
          status: "approved",
          decidedBy: ctx.user.id,
          decidedAt: new Date(),
          createdBy: ctx.user.id,
        })
        .returning()
      if (!r) throw new Error("insert failed")
      return r
    })
    .catch((err) => {
      throw overlapLeave(err)
    })
  await audit(
    ctx,
    "leave.recorded",
    `Recorded ${formatDays(p.halfDays)} of ${p.type.name} for ${e.name}`,
    {
      target: { type: "employee", id: employeeId },
      metadata: { requestId: row.id, startDay: row.startDay, endDay: row.endDay },
    },
  )
  return row
}

async function ownRequest(ctx: Org, id: string) {
  if (!isUuid(id)) throw notFound()
  const [r] = await db
    .select()
    .from(leaveRequest)
    .where(and(eq(leaveRequest.id, id), eq(leaveRequest.orgId, ctx.orgId)))
  if (!r) throw notFound()
  return r
}

/** Approve or decline. Nobody decides their own request; approving re-checks the balance. */
export async function decideLeave(
  ctx: HrContext,
  id: string,
  input: { approve: boolean; note?: string | null },
) {
  const r = await ownRequest(ctx, id)
  const v = parse(decisionSchema, input)
  const e = await ownEmployee(ctx, r.employeeId)
  if (e.userId === ctx.user.id) throw forbidden("You can't decide your own leave request.")
  const settings = await getHrSettings(ctx)
  const [type] = await db.select().from(leaveType).where(eq(leaveType.id, r.leaveTypeId))
  if (!type) throw notFound()
  const decided = await db.transaction(async (tx) => {
    await lockEmployee(tx, ctx, r.employeeId)
    const [now] = await tx.select().from(leaveRequest).where(eq(leaveRequest.id, id)).for("update")
    if (!now || now.status !== "pending")
      throw conflict(`This request is already ${now?.status ?? "gone"}.`)
    if (v.approve) {
      const year = leaveYearOf(now.startDay, settings.leaveYearStartMonth)
      const b = await balanceFor(tx, ctx, now.employeeId, type, year, settings.leaveYearStartMonth)
      if (b.tracked && now.halfDays > (b.remainingHalfDays ?? 0))
        throw conflict(
          `${e.name} only has ${formatDays(Math.max(0, b.remainingHalfDays ?? 0))} of ${type.name.toLowerCase()} left. Add an adjustment first if they're allowed more.`,
        )
    }
    const [row] = await tx
      .update(leaveRequest)
      .set({
        status: v.approve ? "approved" : "rejected",
        decisionNote: v.note,
        decidedBy: ctx.user.id,
        decidedAt: new Date(),
      })
      .where(eq(leaveRequest.id, id))
      .returning()
    if (!row) throw new Error("update failed")
    return row
  })
  await audit(
    ctx,
    v.approve ? "leave.approved" : "leave.declined",
    `${v.approve ? "Approved" : "Declined"} ${formatDays(r.halfDays)} of ${type.name} for ${e.name}`,
    { target: { type: "employee", id: e.id }, metadata: { requestId: id } },
  )
  if (e.userId)
    await notify({
      orgId: ctx.orgId,
      to: [e.userId],
      type: "leave.decided",
      title: `Your ${type.name.toLowerCase()} from ${r.startDay} was ${v.approve ? "approved" : "declined"}`,
      body: v.note ? `${ctx.user.name}: ${v.note}` : undefined,
      link: "/hr/me",
    })
  return decided
}

/**
 * Cancels a request. People can cancel their own pending requests, and
 * approved ones that haven't started. HR (`asManager`) can cancel any open one.
 */
export async function cancelLeave(ctx: HrContext, id: string, opts: { asManager?: boolean } = {}) {
  const r = await ownRequest(ctx, id)
  const e = await ownEmployee(ctx, r.employeeId)
  const mine = e.userId === ctx.user.id
  if (!mine && !opts.asManager) throw notFound()
  const settings = await getHrSettings(ctx)
  if (r.status !== "pending" && r.status !== "approved")
    throw conflict(`This request is already ${r.status}.`)
  if (!opts.asManager && r.status === "approved" && r.startDay <= today(settings.timeZone))
    throw conflict("This leave has started. Ask HR to change it.")
  const [row] = await db
    .update(leaveRequest)
    .set({ status: "cancelled", decidedBy: ctx.user.id, decidedAt: new Date() })
    .where(and(eq(leaveRequest.id, id), inArray(leaveRequest.status, ["pending", "approved"])))
    .returning()
  if (!row) throw conflict("This request has already changed.")
  const [type] = await db
    .select({ name: leaveType.name })
    .from(leaveType)
    .where(eq(leaveType.id, r.leaveTypeId))
  const what = `${formatDays(r.halfDays)} of ${(type?.name ?? "leave").toLowerCase()} from ${r.startDay}`
  if (r.status === "approved") {
    await audit(ctx, "leave.cancelled", `Cancelled approved ${what} for ${e.name}`, {
      target: { type: "employee", id: e.id },
      metadata: { requestId: id },
    })
    const to = mine ? await approversFor(ctx, e, ctx.user.id) : e.userId ? [e.userId] : []
    await notify({
      orgId: ctx.orgId,
      to,
      type: "leave.cancelled",
      title: mine ? `${e.name} cancelled ${what}` : `Your ${what} was cancelled`,
      link: mine ? "/hr/leave" : "/hr/me",
    })
  }
  return row
}

export async function addLeaveAdjustment(
  ctx: HrContext,
  employeeId: string,
  input: AdjustmentInput,
) {
  const e = await ownEmployee(ctx, employeeId)
  const v = parse(adjustmentInputSchema, input)
  const [type] = await db
    .select()
    .from(leaveType)
    .where(and(eq(leaveType.id, v.leaveTypeId), eq(leaveType.orgId, ctx.orgId)))
  if (!type) throw invalid({ leaveTypeId: "Choose the kind of leave from the list" })
  if (type.allowanceHalfDays === null)
    throw invalid({ leaveTypeId: "That kind of leave isn't tracked" })
  const [row] = await db
    .insert(leaveAdjustment)
    .values({
      orgId: ctx.orgId,
      employeeId,
      leaveTypeId: type.id,
      year: v.year,
      halfDays: v.days,
      reason: v.reason,
      createdBy: ctx.user.id,
    })
    .returning()
  await audit(
    ctx,
    "leave.adjusted",
    `${v.days > 0 ? "Gave" : "Took away"} ${formatDays(Math.abs(v.days))} of ${type.name} ${v.days > 0 ? "to" : "from"} ${e.name}: ${v.reason}`,
    { target: { type: "employee", id: employeeId } },
  )
  return row
}

const decider = alias(user, "decider")

export async function listLeave(
  ctx: Org,
  f: { status?: string; employeeId?: string; from?: string; to?: string; limit?: number } = {},
) {
  const where: SQL[] = [eq(leaveRequest.orgId, ctx.orgId)]
  const status = (["pending", "approved", "rejected", "cancelled"] as const).find(
    (s) => s === f.status,
  )
  if (status) where.push(eq(leaveRequest.status, status))
  if (f.employeeId)
    where.push(isUuid(f.employeeId) ? eq(leaveRequest.employeeId, f.employeeId) : sql`false`)
  if (f.from && isDay(f.from)) where.push(gte(leaveRequest.endDay, f.from))
  if (f.to && isDay(f.to)) where.push(lte(leaveRequest.startDay, f.to))
  return db
    .select({
      id: leaveRequest.id,
      employeeId: leaveRequest.employeeId,
      employeeName: employee.name,
      employeeUserId: employee.userId,
      typeName: leaveType.name,
      paid: leaveType.paid,
      startDay: leaveRequest.startDay,
      endDay: leaveRequest.endDay,
      halfDay: leaveRequest.halfDay,
      halfDays: leaveRequest.halfDays,
      status: leaveRequest.status,
      reason: leaveRequest.reason,
      decisionNote: leaveRequest.decisionNote,
      decidedByName: decider.name,
      decidedAt: leaveRequest.decidedAt,
      createdAt: leaveRequest.createdAt,
    })
    .from(leaveRequest)
    .innerJoin(employee, eq(employee.id, leaveRequest.employeeId))
    .innerJoin(leaveType, eq(leaveType.id, leaveRequest.leaveTypeId))
    .leftJoin(decider, eq(decider.id, leaveRequest.decidedBy))
    .where(and(...where))
    .orderBy(status === "pending" ? asc(leaveRequest.startDay) : desc(leaveRequest.startDay))
    .limit(Math.min(500, f.limit ?? 200))
}

/** Who's off between two days. Only names and dates: the kind of leave stays private. */
export async function whoIsOff(ctx: Org, from: string, to: string) {
  const rows = await listLeave(ctx, { status: "approved", from, to })
  return rows
    .map((r) => ({
      employeeId: r.employeeId,
      name: r.employeeName,
      startDay: r.startDay,
      endDay: r.endDay,
      halfDay: r.halfDay,
    }))
    .sort((a, b) => a.startDay.localeCompare(b.startDay))
}

/** Headcount, who's clocked in now, who's off today and requests waiting. */
export async function hrSummary(ctx: Org) {
  const settings = await getHrSettings(ctx)
  const day = today(settings.timeZone)
  const [[people], clockedIn, off, [pending]] = await Promise.all([
    db
      .select({ n: count() })
      .from(employee)
      .where(and(eq(employee.orgId, ctx.orgId), eq(employee.status, "active"))),
    db
      .select({ employeeId: timeEntry.employeeId, name: employee.name, since: timeEntry.clockIn })
      .from(timeEntry)
      .innerJoin(employee, eq(employee.id, timeEntry.employeeId))
      .where(and(eq(timeEntry.orgId, ctx.orgId), isNull(timeEntry.clockOut)))
      .orderBy(asc(timeEntry.clockIn)),
    whoIsOff(ctx, day, day),
    db
      .select({ n: count() })
      .from(leaveRequest)
      .where(and(eq(leaveRequest.orgId, ctx.orgId), eq(leaveRequest.status, "pending"))),
  ])
  return {
    day,
    timeZone: settings.timeZone,
    headcount: people?.n ?? 0,
    clockedIn,
    offToday: off,
    pendingRequests: pending?.n ?? 0,
  }
}
