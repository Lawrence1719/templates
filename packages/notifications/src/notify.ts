import "server-only"

import { db } from "@templates/db"
import { member, notification, user } from "@templates/db/schema"
import { and, eq, inArray } from "drizzle-orm"

import { appUrl, renderEmail, sendEmail } from "./email"
import { channelsFor } from "./preferences"
import type { NotificationType } from "./types"

export type NotifyInput = {
  orgId: string
  /** Recipient user IDs. Users who aren't members of `orgId` are skipped. */
  to: string[]
  type: NotificationType
  title: string
  body?: string
  /** Internal path, e.g. "/settings/organization". */
  link?: string
  /**
   * Send even to non-members (e.g. the person who was just removed).
   * Only email is sent to them; they can't see in-app notifications.
   */
  allowNonMembers?: boolean
}

/**
 * Notifies users in-app and/or by email according to their preferences.
 * Never throws: a failed notification must not break the action behind it.
 * Returns what was delivered, for logging and tests.
 */
export async function notify(input: NotifyInput) {
  const sent = { inApp: 0, email: 0 }
  try {
    const ids = [...new Set(input.to)]
    if (!ids.length) return sent

    const members = new Set(
      (
        await db
          .select({ userId: member.userId })
          .from(member)
          .where(and(eq(member.organizationId, input.orgId), inArray(member.userId, ids)))
      ).map((m) => m.userId),
    )
    const recipients = input.allowNonMembers ? ids : ids.filter((id) => members.has(id))
    if (!recipients.length) return sent

    const [channels, users] = await Promise.all([
      channelsFor(recipients, input.type),
      db.select({ id: user.id, email: user.email }).from(user).where(inArray(user.id, recipients)),
    ])
    const link =
      input.link?.startsWith("/") && !input.link.startsWith("//") ? input.link : undefined

    const inAppRows = recipients
      .filter((id) => channels.get(id)?.inApp && members.has(id))
      .map((userId) => ({
        orgId: input.orgId,
        userId,
        type: input.type,
        title: input.title,
        body: input.body,
        link,
      }))
    if (inAppRows.length) {
      await db.insert(notification).values(inAppRows)
      sent.inApp = inAppRows.length
    }

    const emailTo = users.filter((u) => channels.get(u.id)?.email)
    const results = await Promise.allSettled(
      emailTo.map((u) =>
        sendEmail({
          to: u.email,
          ...renderEmail({
            subject: input.title,
            heading: input.title,
            paragraphs: input.body ? [input.body] : [],
            action: link && members.has(u.id) ? { label: "Open", url: appUrl(link) } : undefined,
            footer: "Change which emails you get in Settings → Notifications.",
          }),
        }),
      ),
    )
    sent.email = results.filter((r) => r.status === "fulfilled").length
    for (const r of results)
      if (r.status === "rejected") console.error("[notify] email failed", r.reason)
  } catch (error) {
    console.error("[notify] failed", input.type, error)
  }
  return sent
}

/** User IDs of members holding any of these roles. */
export async function membersWithRole(orgId: string, roles: string[]) {
  const rows = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, orgId), inArray(member.role, roles)))
  return rows.map((r) => r.userId)
}
