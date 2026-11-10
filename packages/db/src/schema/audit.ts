import { sql } from "drizzle-orm"
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

import { organization, user } from "./auth"

/**
 * Append-only record of who did what, in which organization.
 * UPDATE and DELETE are blocked by a database trigger (see migration 0001).
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Kept nullable + snapshot fields so history survives a deleted user.
    actorId: uuid("actor_id").references(() => user.id, { onDelete: "set null" }),
    actorName: text("actor_name"),
    actorEmail: text("actor_email"),
    /** Dotted verb, e.g. "member.role_changed", "customer.deleted". */
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    /** Short human summary shown in the UI. */
    summary: text("summary").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("audit_log_org_created_idx").on(t.orgId, t.createdAt.desc()),
    index("audit_log_org_action_idx").on(t.orgId, t.action),
  ],
)

export type AuditLogEntry = typeof auditLog.$inferSelect
