import { sql } from "drizzle-orm"
import { boolean, index, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core"

import { organization, user } from "./auth"

/** In-app notifications. One row per recipient. */
export const notification = pgTable(
  "notification",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Registered type, e.g. "member.role_changed". Drives preferences. */
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    /** Internal path to open, e.g. "/settings/organization". */
    link: text("link"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("notification_inbox_idx").on(t.userId, t.orgId, t.createdAt.desc()),
    index("notification_unread_idx").on(t.userId, t.orgId).where(sql`${t.readAt} is null`),
  ],
)

/** Per-user overrides of a type's default channels. Missing row = use defaults. */
export const notificationPreference = pgTable(
  "notification_preference",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    inApp: boolean("in_app").notNull(),
    email: boolean("email").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.type] })],
)

export type Notification = typeof notification.$inferSelect
