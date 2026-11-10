import "server-only"

import { db } from "@templates/db"
import { notification } from "@templates/db/schema"
import { and, count, desc, eq, inArray, isNull, lt } from "drizzle-orm"

/**
 * Every function takes the session's userId AND orgId and filters by both,
 * so a user only ever sees or changes their own notifications in the active org.
 */
type Owner = { userId: string; orgId: string }
const own = ({ userId, orgId }: Owner) =>
  and(eq(notification.userId, userId), eq(notification.orgId, orgId))

export async function listNotifications(
  owner: Owner,
  opts: { limit?: number; before?: Date; unreadOnly?: boolean } = {},
) {
  const limit = Math.min(opts.limit ?? 20, 100)
  return db
    .select()
    .from(notification)
    .where(
      and(
        own(owner),
        opts.before ? lt(notification.createdAt, opts.before) : undefined,
        opts.unreadOnly ? isNull(notification.readAt) : undefined,
      ),
    )
    .orderBy(desc(notification.createdAt), desc(notification.id))
    .limit(limit)
}

export async function unreadCount(owner: Owner) {
  const [r] = await db
    .select({ n: count() })
    .from(notification)
    .where(and(own(owner), isNull(notification.readAt)))
  return r?.n ?? 0
}

/** Marks the given notifications (or all) read. IDs belonging to anyone else are ignored. */
export async function markRead(owner: Owner, ids: string[] | "all") {
  if (ids !== "all" && ids.length === 0) return 0
  const rows = await db
    .update(notification)
    .set({ readAt: new Date() })
    .where(
      and(
        own(owner),
        isNull(notification.readAt),
        ids === "all" ? undefined : inArray(notification.id, ids),
      ),
    )
    .returning({ id: notification.id })
  return rows.length
}
