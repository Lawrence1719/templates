import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
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

/** A company or person the organization sells to. */
export const customer = pgTable(
  "customer",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    kind: text("kind", { enum: ["company", "person"] })
      .notNull()
      .default("company"),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    website: text("website"),
    address: text("address"),
    /** lead → active → inactive */
    status: text("status", { enum: ["lead", "active", "inactive"] })
      .notNull()
      .default("lead"),
    /** The member responsible for this customer. Must belong to the same org. */
    ownerId: uuid("owner_id").references(() => user.id, { onDelete: "set null" }),
    /** Lowercase labels, e.g. {"wholesale","vip"}. */
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("customer_org_idx").on(t.orgId, t.updatedAt.desc()),
    index("customer_org_status_idx").on(t.orgId, t.status),
    index("customer_org_owner_idx").on(t.orgId, t.ownerId),
    index("customer_tags_idx").using("gin", t.tags),
    // Lets child tables reference (id, org_id), so a row can never point at another org's customer.
    unique("customer_id_org_uq").on(t.id, t.orgId),
  ],
)

/** A person at a customer: who you actually talk to. */
export const customerContact = pgTable(
  "customer_contact",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    customerId: uuid("customer_id").notNull(),
    name: text("name").notNull(),
    title: text("title"),
    email: text("email"),
    phone: text("phone"),
    isPrimary: boolean("is_primary").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    index("customer_contact_customer_idx").on(t.customerId),
    foreignKey({
      name: "customer_contact_customer_fk",
      columns: [t.customerId, t.orgId],
      foreignColumns: [customer.id, customer.orgId],
    }).onDelete("cascade"),
  ],
)

export const DEAL_STAGES = ["new", "qualified", "proposal", "won", "lost"] as const

/** A potential sale, moving through the pipeline. */
export const deal = pgTable(
  "deal",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    customerId: uuid("customer_id").notNull(),
    title: text("title").notNull(),
    /** Minor units (cents) to avoid floating-point money. */
    valueCents: bigint("value_cents", { mode: "number" }).notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    stage: text("stage", { enum: DEAL_STAGES }).notNull().default("new"),
    ownerId: uuid("owner_id").references(() => user.id, { onDelete: "set null" }),
    expectedCloseOn: date("expected_close_on"),
    /** Set when the deal moves to won or lost, cleared if it's reopened. */
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("deal_org_stage_idx").on(t.orgId, t.stage),
    index("deal_customer_idx").on(t.customerId),
    foreignKey({
      name: "deal_customer_fk",
      columns: [t.customerId, t.orgId],
      foreignColumns: [customer.id, customer.orgId],
    }).onDelete("cascade"),
  ],
)

/**
 * The customer's timeline: notes, calls, emails and meetings people log,
 * plus `system` entries the module writes (e.g. a deal changing stage).
 */
export const crmActivity = pgTable(
  "crm_activity",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    customerId: uuid("customer_id").notNull(),
    dealId: uuid("deal_id").references(() => deal.id, { onDelete: "set null" }),
    kind: text("kind", { enum: ["note", "call", "email", "meeting", "system"] }).notNull(),
    body: text("body").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("crm_activity_customer_idx").on(t.customerId, t.occurredAt.desc()),
    foreignKey({
      name: "crm_activity_customer_fk",
      columns: [t.customerId, t.orgId],
      foreignColumns: [customer.id, customer.orgId],
    }).onDelete("cascade"),
  ],
)

export type Customer = typeof customer.$inferSelect
export type CustomerContact = typeof customerContact.$inferSelect
export type Deal = typeof deal.$inferSelect
export type DealStage = (typeof DEAL_STAGES)[number]
export type CrmActivity = typeof crmActivity.$inferSelect
