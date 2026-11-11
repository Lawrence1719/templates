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
import { customer } from "./crm"
import { invoice } from "./invoicing"

const orgId = () =>
  uuid("org_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" })

export const PERIOD_UNITS = ["day", "week", "month", "year"] as const
export const MEMBERSHIP_STATUSES = ["active", "paused", "cancelled"] as const
export const PAID_VIA = ["cash", "card", "other", "invoice", "free"] as const
export const MEMBERSHIP_EVENT_KINDS = [
  "started",
  "renewed",
  "paused",
  "resumed",
  "cancelled",
  "card_replaced",
  "note",
] as const

export const membershipSettings = pgTable("membership_settings", {
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  timeZone: text("time_zone").notNull().default("UTC"),
  /** A second check-in within this many minutes is refused (a double scan). */
  checkInCooldownMinutes: integer("check_in_cooldown_minutes").notNull().default(60),
  /** Email a renewal reminder this many days before a membership ends. 0 turns it off. */
  reminderDays: integer("reminder_days").notNull().default(7),
})

/** What people sign up for: a price per period, with or without a visit limit. */
export const membershipPlan = pgTable(
  "membership_plan",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    name: text("name").notNull(),
    description: text("description"),
    priceCents: bigint("price_cents", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    /** One period is `periodCount` × `periodUnit`, e.g. 1 month or 10 days. */
    periodUnit: text("period_unit", { enum: PERIOD_UNITS }).notNull(),
    periodCount: integer("period_count").notNull().default(1),
    /** Visits per period. Null means unlimited. */
    visitLimit: integer("visit_limit"),
    status: text("status", { enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("membership_plan_name_uq").on(t.orgId, sql`lower(${t.name})`),
    unique("membership_plan_id_org_uq").on(t.id, t.orgId),
  ],
)

/** One customer on one plan. `periodEnd` is the last day they can come in. */
export const membership = pgTable(
  "membership",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    customerId: uuid("customer_id").notNull(),
    planId: uuid("plan_id").notNull(),
    status: text("status", { enum: MEMBERSHIP_STATUSES }).notNull().default("active"),
    startedOn: date("started_on").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    autoRenew: boolean("auto_renew").notNull().default(false),
    /** On the member's card and in their card link. Replaceable if the card is lost. */
    cardToken: text("card_token").notNull(),
    pausedOn: date("paused_on"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    /** The period end a renewal reminder was sent for, so each period gets one. */
    remindedFor: date("reminded_for"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("membership_card_uq").on(t.cardToken),
    index("membership_org_idx").on(t.orgId, t.status, t.periodEnd),
    index("membership_customer_idx").on(t.customerId),
    unique("membership_id_org_uq").on(t.id, t.orgId),
    foreignKey({
      name: "membership_customer_fk",
      columns: [t.customerId, t.orgId],
      foreignColumns: [customer.id, customer.orgId],
    }).onDelete("no action"),
    foreignKey({
      name: "membership_plan_fk",
      columns: [t.planId, t.orgId],
      foreignColumns: [membershipPlan.id, membershipPlan.orgId],
    }).onDelete("no action"),
  ],
)

/** Each paid period: what was charged and how. Append-only. */
export const membershipPeriod = pgTable(
  "membership_period",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    membershipId: uuid("membership_id").notNull(),
    startDay: date("start_day").notNull(),
    endDay: date("end_day").notNull(),
    priceCents: bigint("price_cents", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    paidVia: text("paid_via", { enum: PAID_VIA }).notNull(),
    invoiceId: uuid("invoice_id"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("membership_period_membership_idx").on(t.membershipId, t.startDay),
    foreignKey({
      name: "membership_period_membership_fk",
      columns: [t.membershipId, t.orgId],
      foreignColumns: [membership.id, membership.orgId],
    }).onDelete("cascade"),
    foreignKey({
      name: "membership_period_invoice_fk",
      columns: [t.invoiceId, t.orgId],
      foreignColumns: [invoice.id, invoice.orgId],
    }).onDelete("no action"),
  ],
)

/** A visit. Append-only; a mistaken one is voided, never deleted. */
export const membershipCheckIn = pgTable(
  "membership_check_in",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    membershipId: uuid("membership_id").notNull(),
    /** The period it counts against (for visit limits). */
    periodStart: date("period_start").notNull(),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }).defaultNow().notNull(),
    /** "card" when the code was scanned or typed, "desk" when staff picked the member. */
    method: text("method", { enum: ["card", "desk"] }).notNull(),
    checkedInBy: uuid("checked_in_by").references(() => user.id, { onDelete: "set null" }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: uuid("voided_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    index("membership_check_in_membership_idx").on(t.membershipId, t.checkedInAt.desc()),
    index("membership_check_in_org_idx").on(t.orgId, t.checkedInAt.desc()),
    foreignKey({
      name: "membership_check_in_membership_fk",
      columns: [t.membershipId, t.orgId],
      foreignColumns: [membership.id, membership.orgId],
    }).onDelete("cascade"),
  ],
)

/** What happened to a membership and who did it. Append-only. */
export const membershipEvent = pgTable(
  "membership_event",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    membershipId: uuid("membership_id").notNull(),
    kind: text("kind", { enum: MEMBERSHIP_EVENT_KINDS }).notNull(),
    body: text("body").notNull(),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("membership_event_membership_idx").on(t.membershipId, t.createdAt),
    foreignKey({
      name: "membership_event_membership_fk",
      columns: [t.membershipId, t.orgId],
      foreignColumns: [membership.id, membership.orgId],
    }).onDelete("cascade"),
  ],
)

export type MembershipPlan = typeof membershipPlan.$inferSelect
export type Membership = typeof membership.$inferSelect
export type MembershipPeriod = typeof membershipPeriod.$inferSelect
export type MembershipCheckIn = typeof membershipCheckIn.$inferSelect
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number]
