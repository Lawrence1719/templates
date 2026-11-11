import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"

import { organization, user } from "./auth"
import { customer } from "./crm"

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

export const BOOKING_STATUSES = [
  "pending",
  "confirmed",
  "cancelled",
  "completed",
  "no_show",
] as const

/** One row per org: how booking works. */
export const bookingSettings = pgTable("booking_settings", {
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  /** IANA time zone the business runs in, e.g. "Asia/Manila". Hours are in this zone. */
  timeZone: text("time_zone").notNull().default("UTC"),
  /** Slots start every N minutes. */
  slotMinutes: smallint("slot_minutes").notNull().default(30),
  /** Earliest booking: this many minutes from now. */
  minNoticeMinutes: integer("min_notice_minutes").notNull().default(120),
  /** Latest booking: this many days ahead. */
  maxDaysAhead: smallint("max_days_ahead").notNull().default(60),
  /** Online bookings wait for staff to confirm. */
  requireApproval: boolean("require_approval").notNull().default(false),
  /** The public booking page is on. */
  publicEnabled: boolean("public_enabled").notNull().default(false),
  /** Unguessable part of the public booking link. */
  publicSlug: text("public_slug").notNull().unique(),
  /** Customers can cancel online until this many minutes before the start. */
  cancelNoticeMinutes: integer("cancel_notice_minutes").notNull().default(1440),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
})

/** Something people book: a haircut, a consultation, a room hire. */
export const bookingService = pgTable(
  "booking_service",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    name: text("name").notNull(),
    description: text("description"),
    durationMinutes: smallint("duration_minutes").notNull(),
    /** Gap kept free after each booking (clean-up, travel). */
    bufferMinutes: smallint("buffer_minutes").notNull().default(0),
    priceCents: bigint("price_cents", { mode: "number" }).notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    /** Who can do it. Empty means everyone. */
    resourceIds: uuid("resource_ids").array().notNull().default(sql`'{}'::uuid[]`),
    status: text("status", { enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    ...timestamps,
  },
  (t) => [
    index("booking_service_org_idx").on(t.orgId, t.status),
    unique("booking_service_id_org_uq").on(t.id, t.orgId),
    check(
      "booking_service_duration_check",
      sql`${t.durationMinutes} between 5 and 1440 and ${t.bufferMinutes} between 0 and 240`,
    ),
  ],
)

/** Who or what is booked: a staff member, a room, a court. */
export const bookingResource = pgTable(
  "booking_resource",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    name: text("name").notNull(),
    /** The team member this is, if it's a person (they get notified). */
    userId: uuid("user_id").references(() => user.id, { onDelete: "set null" }),
    status: text("status", { enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    ...timestamps,
  },
  (t) => [unique("booking_resource_id_org_uq").on(t.id, t.orgId)],
)

/** Weekly opening hours per resource, in the org's time zone. Several per day allowed. */
export const bookingHours = pgTable(
  "booking_hours",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    resourceId: uuid("resource_id").notNull(),
    /** 0 = Sunday … 6 = Saturday. */
    weekday: smallint("weekday").notNull(),
    startMinute: smallint("start_minute").notNull(),
    endMinute: smallint("end_minute").notNull(),
  },
  (t) => [
    index("booking_hours_resource_idx").on(t.resourceId, t.weekday),
    foreignKey({
      name: "booking_hours_resource_fk",
      columns: [t.resourceId, t.orgId],
      foreignColumns: [bookingResource.id, bookingResource.orgId],
    }).onDelete("cascade"),
    check(
      "booking_hours_range_check",
      sql`${t.weekday} between 0 and 6 and ${t.startMinute} >= 0 and ${t.endMinute} <= 1440 and ${t.startMinute} < ${t.endMinute}`,
    ),
  ],
)

export const bookingTimeOff = pgTable(
  "booking_time_off",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    resourceId: uuid("resource_id").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    reason: text("reason"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("booking_time_off_resource_idx").on(t.resourceId, t.startsAt),
    foreignKey({
      name: "booking_time_off_resource_fk",
      columns: [t.resourceId, t.orgId],
      foreignColumns: [bookingResource.id, bookingResource.orgId],
    }).onDelete("cascade"),
    check("booking_time_off_range_check", sql`${t.startsAt} < ${t.endsAt}`),
  ],
)

export const booking = pgTable(
  "booking",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    serviceId: uuid("service_id").notNull(),
    resourceId: uuid("resource_id").notNull(),
    /** Linked CRM customer, when staff booked for one. */
    customerId: uuid("customer_id"),
    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email"),
    customerPhone: text("customer_phone"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /** End plus the service's buffer: the time this booking keeps the resource busy. */
    blockedUntil: timestamp("blocked_until", { withTimezone: true }).notNull(),
    status: text("status", { enum: BOOKING_STATUSES }).notNull().default("confirmed"),
    source: text("source", { enum: ["staff", "online"] })
      .notNull()
      .default("staff"),
    notes: text("notes"),
    cancelReason: text("cancel_reason"),
    /** Unguessable link the customer uses to view or cancel. */
    manageToken: text("manage_token").notNull().unique(),
    /** Salted hash of the booker's IP, for rate limiting online bookings. */
    ipHash: text("ip_hash"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("booking_org_time_idx").on(t.orgId, t.startsAt),
    index("booking_resource_time_idx").on(t.resourceId, t.startsAt),
    index("booking_rate_idx").on(t.orgId, t.ipHash, t.createdAt),
    foreignKey({
      name: "booking_service_fk",
      columns: [t.serviceId, t.orgId],
      foreignColumns: [bookingService.id, bookingService.orgId],
    }).onDelete("no action"),
    foreignKey({
      name: "booking_resource_fk",
      columns: [t.resourceId, t.orgId],
      foreignColumns: [bookingResource.id, bookingResource.orgId],
    }).onDelete("no action"),
    foreignKey({
      name: "booking_customer_fk",
      columns: [t.customerId, t.orgId],
      foreignColumns: [customer.id, customer.orgId],
    }).onDelete("no action"),
    check(
      "booking_time_check",
      sql`${t.startsAt} < ${t.endsAt} and ${t.endsAt} <= ${t.blockedUntil}`,
    ),
  ],
)

export type BookingSettings = typeof bookingSettings.$inferSelect
export type BookingService = typeof bookingService.$inferSelect
export type BookingResource = typeof bookingResource.$inferSelect
export type BookingHours = typeof bookingHours.$inferSelect
export type BookingTimeOff = typeof bookingTimeOff.$inferSelect
export type Booking = typeof booking.$inferSelect
export type BookingStatus = (typeof BOOKING_STATUSES)[number]
