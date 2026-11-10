import { sql } from "drizzle-orm"
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

import { organization, user } from "./auth"

/** A form built by an organization. `fields` is validated by @templates/forms. */
export const form = pgTable(
  "form",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    /** Unguessable public identifier used in share links. */
    slug: text("slug").notNull().unique(),
    fields: jsonb("fields").$type<unknown[]>().notNull().default([]),
    /** draft → published → closed */
    status: text("status", { enum: ["draft", "published", "closed"] })
      .notNull()
      .default("draft"),
    /** public: anyone with the link · members: signed-in members of the org */
    visibility: text("visibility", { enum: ["public", "members"] })
      .notNull()
      .default("public"),
    /** Shown after a successful submission. */
    confirmation: text("confirmation"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("form_org_idx").on(t.orgId, t.createdAt.desc())],
)

export const formSubmission = pgTable(
  "form_submission",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    formId: uuid("form_id")
      .notNull()
      .references(() => form.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Answers keyed by field id, validated against the form at submit time. */
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    submittedBy: uuid("submitted_by").references(() => user.id, { onDelete: "set null" }),
    /** Salted hash of the submitter's IP, for rate limiting without storing the IP. */
    ipHash: text("ip_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("form_submission_form_idx").on(t.formId, t.createdAt.desc()),
    index("form_submission_rate_idx").on(t.formId, t.ipHash, t.createdAt),
  ],
)

export type FormRecord = typeof form.$inferSelect
export type FormSubmission = typeof formSubmission.$inferSelect
