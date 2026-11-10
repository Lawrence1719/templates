"use server"

import { requireOrg } from "@templates/auth/guards"
import {
  getPreferences,
  listNotifications,
  markRead,
  setPreference,
  unreadCount,
} from "@templates/notifications"
import { z } from "zod"

/** Every action reads userId + orgId from the session — never from the client. */
async function owner() {
  const { user, orgId } = await requireOrg()
  return { userId: user.id, orgId }
}

export async function getInbox() {
  const o = await owner()
  const [items, unread] = await Promise.all([listNotifications(o, { limit: 10 }), unreadCount(o)])
  return { items, unread }
}

export async function getUnreadCount() {
  return unreadCount(await owner())
}

const idsSchema = z.union([z.literal("all"), z.array(z.uuid()).max(100)])

export async function markNotificationsRead(ids: string[] | "all") {
  return markRead(await owner(), idsSchema.parse(ids))
}

const prefSchema = z.object({ type: z.string().max(100), inApp: z.boolean(), email: z.boolean() })

export async function saveNotificationPreference(input: z.infer<typeof prefSchema>) {
  const { userId } = await owner()
  const { type, inApp, email } = prefSchema.parse(input)
  await setPreference(userId, type, { inApp, email })
  return getPreferences(userId)
}
