import "server-only"

import { db } from "@templates/db"
import { notificationPreference } from "@templates/db/schema"
import { and, eq, inArray } from "drizzle-orm"

import {
  type Channels,
  isNotificationType,
  type NotificationType,
  notificationTypes,
} from "./types"

/** Effective channels for every type, for one user (defaults merged with overrides). */
export async function getPreferences(userId: string) {
  const rows = await db
    .select()
    .from(notificationPreference)
    .where(eq(notificationPreference.userId, userId))
  const overrides = new Map(rows.map((r) => [r.type, r]))
  return (Object.keys(notificationTypes) as NotificationType[]).map((type) => {
    const cfg = notificationTypes[type]
    const o = overrides.get(type)
    const required = "required" in cfg && cfg.required === true
    return {
      type,
      label: cfg.label,
      description: cfg.description,
      required,
      // Required types always use their defaults.
      channels: required || !o ? cfg.defaults : { inApp: o.inApp, email: o.email },
    }
  })
}

/** Saves a user's channels for one type. Rejects unknown or required types. */
export async function setPreference(userId: string, type: string, channels: Channels) {
  if (!isNotificationType(type)) throw new Error(`Unknown notification type: ${type}`)
  const cfg = notificationTypes[type]
  if ("required" in cfg && cfg.required) throw new Error(`${type} can't be turned off`)
  await db
    .insert(notificationPreference)
    .values({ userId, type, ...channels })
    .onConflictDoUpdate({
      target: [notificationPreference.userId, notificationPreference.type],
      set: { ...channels, updatedAt: new Date() },
    })
}

/** Channels for many users and one type, in one query. */
export async function channelsFor(
  userIds: string[],
  type: NotificationType,
): Promise<Map<string, Channels>> {
  const cfg = notificationTypes[type]
  const result = new Map<string, Channels>(userIds.map((id) => [id, cfg.defaults]))
  if ("required" in cfg && cfg.required) return result
  if (!userIds.length) return result
  const rows = await db
    .select()
    .from(notificationPreference)
    .where(
      and(eq(notificationPreference.type, type), inArray(notificationPreference.userId, userIds)),
    )
  for (const r of rows) result.set(r.userId, { inApp: r.inApp, email: r.email })
  return result
}
