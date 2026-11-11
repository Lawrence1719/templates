import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { organization, user } from "./auth"

const orgId = () =>
  uuid("org_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" })

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
}

export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "intern"] as const
export const EMPLOYEE_STATUSES = ["active", "left"] as const
export const PAY_TYPES = ["hourly", "salary"] as const
export const LEAVE_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const

/** Per-org HR settings. */
export const hrSettings = pgTable("hr_settings", {
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  /** Days are counted and timesheets cut in this zone. */
  timeZone: text("time_zone").notNull().default("UTC"),
  /** ISO weekdays people work (1 = Monday … 7 = Sunday). Leave only counts these. */
  workDays: integer("work_days").array().notNull().default(sql`'{1,2,3,4,5}'`),
  /** The month the leave year starts (1 = January). */
  leaveYearStartMonth: integer("leave_year_start_month").notNull().default(1),
  /** Hours per week before time counts as overtime on timesheets. */
  weeklyHours: integer("weekly_hours").notNull().default(40),
})

export const hrDepartment = pgTable(
  "hr_department",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("hr_department_name_uq").on(t.orgId, sql`lower(${t.name})`),
    unique("hr_department_id_org_uq").on(t.id, t.orgId),
  ],
)

/** A person who works for the organization, with or without an app account. */
export const employee = pgTable(
  "employee",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    /** Their app account, so they can clock in and request leave themselves. */
    userId: uuid("user_id").references(() => user.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    workEmail: text("work_email"),
    phone: text("phone"),
    jobTitle: text("job_title"),
    departmentId: uuid("department_id"),
    managerId: uuid("manager_id"),
    employmentType: text("employment_type", { enum: EMPLOYMENT_TYPES })
      .notNull()
      .default("full_time"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    status: text("status", { enum: EMPLOYEE_STATUSES }).notNull().default("active"),
    // ----- Private: only people with `hr: manage` see these -----
    payType: text("pay_type", { enum: PAY_TYPES }),
    /** Per hour for hourly pay, per year for salary. */
    payRateCents: bigint("pay_rate_cents", { mode: "number" }),
    payCurrency: text("pay_currency"),
    birthDate: date("birth_date"),
    homeAddress: text("home_address"),
    emergencyContactName: text("emergency_contact_name"),
    emergencyContactPhone: text("emergency_contact_phone"),
    privateNotes: text("private_notes"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("employee_user_uq").on(t.orgId, t.userId).where(sql`${t.userId} is not null`),
    index("employee_org_idx").on(t.orgId, t.status, t.name),
    unique("employee_id_org_uq").on(t.id, t.orgId),
    foreignKey({
      name: "employee_department_fk",
      columns: [t.departmentId, t.orgId],
      foreignColumns: [hrDepartment.id, hrDepartment.orgId],
    }).onDelete("no action"),
    foreignKey({
      name: "employee_manager_fk",
      columns: [t.managerId, t.orgId],
      foreignColumns: [t.id, t.orgId],
    }).onDelete("no action"),
  ],
)

/** Clocked time. One open entry per person; entries never overlap (enforced in SQL). */
export const timeEntry = pgTable(
  "time_entry",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    employeeId: uuid("employee_id").notNull(),
    clockIn: timestamp("clock_in", { withTimezone: true }).notNull(),
    clockOut: timestamp("clock_out", { withTimezone: true }),
    note: text("note"),
    /** "clock" from the time clock, "manual" when HR added or corrected it. */
    source: text("source", { enum: ["clock", "manual"] })
      .notNull()
      .default("clock"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    editedBy: uuid("edited_by").references(() => user.id, { onDelete: "set null" }),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("time_entry_open_uq").on(t.employeeId).where(sql`${t.clockOut} is null`),
    index("time_entry_employee_idx").on(t.employeeId, t.clockIn.desc()),
    index("time_entry_org_idx").on(t.orgId, t.clockIn.desc()),
    foreignKey({
      name: "time_entry_employee_fk",
      columns: [t.employeeId, t.orgId],
      foreignColumns: [employee.id, employee.orgId],
    }).onDelete("cascade"),
  ],
)

export const leaveType = pgTable(
  "leave_type",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    name: text("name").notNull(),
    /** Days per leave year, in half days (30 = 15 days). Null means not tracked. */
    allowanceHalfDays: integer("allowance_half_days"),
    paid: boolean("paid").notNull().default(true),
    status: text("status", { enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("leave_type_name_uq").on(t.orgId, sql`lower(${t.name})`),
    unique("leave_type_id_org_uq").on(t.id, t.orgId),
  ],
)

/** Days that don't count as leave (public holidays, company days off). */
export const hrHoliday = pgTable(
  "hr_holiday",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    day: date("day").notNull(),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("hr_holiday_day_uq").on(t.orgId, t.day)],
)

export const leaveRequest = pgTable(
  "leave_request",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    employeeId: uuid("employee_id").notNull(),
    leaveTypeId: uuid("leave_type_id").notNull(),
    startDay: date("start_day").notNull(),
    endDay: date("end_day").notNull(),
    /** A half day (single-day requests only). */
    halfDay: boolean("half_day").notNull().default(false),
    /** Working days taken, in half days, worked out on the server. */
    halfDays: integer("half_days").notNull(),
    status: text("status", { enum: LEAVE_STATUSES }).notNull().default("pending"),
    reason: text("reason"),
    decisionNote: text("decision_note"),
    decidedBy: uuid("decided_by").references(() => user.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("leave_request_employee_idx").on(t.employeeId, t.startDay.desc()),
    index("leave_request_org_idx").on(t.orgId, t.status, t.startDay),
    foreignKey({
      name: "leave_request_employee_fk",
      columns: [t.employeeId, t.orgId],
      foreignColumns: [employee.id, employee.orgId],
    }).onDelete("cascade"),
    foreignKey({
      name: "leave_request_type_fk",
      columns: [t.leaveTypeId, t.orgId],
      foreignColumns: [leaveType.id, leaveType.orgId],
    }).onDelete("no action"),
  ],
)

/** Extra or fewer days for one person and year (carry-over, corrections). Append-only. */
export const leaveAdjustment = pgTable(
  "leave_adjustment",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    employeeId: uuid("employee_id").notNull(),
    leaveTypeId: uuid("leave_type_id").notNull(),
    /** The calendar year the leave year starts in. */
    year: integer("year").notNull(),
    halfDays: integer("half_days").notNull(),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("leave_adjustment_employee_idx").on(t.employeeId, t.year),
    foreignKey({
      name: "leave_adjustment_employee_fk",
      columns: [t.employeeId, t.orgId],
      foreignColumns: [employee.id, employee.orgId],
    }).onDelete("cascade"),
    foreignKey({
      name: "leave_adjustment_type_fk",
      columns: [t.leaveTypeId, t.orgId],
      foreignColumns: [leaveType.id, leaveType.orgId],
    }).onDelete("cascade"),
  ],
)

export type HrSettings = typeof hrSettings.$inferSelect
export type Employee = typeof employee.$inferSelect
export type TimeEntry = typeof timeEntry.$inferSelect
export type LeaveType = typeof leaveType.$inferSelect
export type LeaveRequest = typeof leaveRequest.$inferSelect
export type LeaveStatus = (typeof LEAVE_STATUSES)[number]
