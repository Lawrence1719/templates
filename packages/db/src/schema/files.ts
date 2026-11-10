import { sql } from "drizzle-orm"
import { bigint, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

import { organization, user } from "./auth"

/**
 * Metadata for an uploaded file. The bytes live in storage under `storage_key`,
 * which is generated server-side and never derived from the user's filename.
 */
export const file = pgTable(
  "file",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    uploadedBy: uuid("uploaded_by").references(() => user.id, { onDelete: "set null" }),
    /** Display name, sanitized. */
    name: text("name").notNull(),
    /** Detected from the file's bytes, not the browser's claim. */
    mimeType: text("mime_type").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    /** Optional link to any record, e.g. ("customer", "<id>"). */
    attachedToType: text("attached_to_type"),
    attachedToId: text("attached_to_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("file_org_created_idx").on(t.orgId, t.createdAt.desc()),
    index("file_attachment_idx").on(t.orgId, t.attachedToType, t.attachedToId),
  ],
)

export type FileRecord = typeof file.$inferSelect
