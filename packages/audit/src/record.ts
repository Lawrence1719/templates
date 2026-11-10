import "server-only"

import { db } from "@templates/db"
import { auditLog } from "@templates/db/schema"
import { headers } from "next/headers"

export type AuditActor = { id: string; name?: string | null; email?: string | null } | null

export type AuditEvent = {
  orgId: string
  /** Who did it. `null` for system jobs. */
  actor: AuditActor
  /** Dotted verb: "<resource>.<past-tense>", e.g. "customer.deleted". */
  action: string
  target?: { type: string; id: string }
  /** One line a human can read in the log, e.g. "Removed Jane from Acme". */
  summary: string
  metadata?: Record<string, unknown>
}

const MAX_METADATA_BYTES = 8_000

async function requestInfo() {
  try {
    const h = await headers()
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip")
    return { ip: ip ?? null, userAgent: h.get("user-agent")?.slice(0, 500) ?? null }
  } catch {
    // Called outside a request (scripts, jobs).
    return { ip: null, userAgent: null }
  }
}

/**
 * Append one entry to the audit log.
 * Never throws: a logging failure must not break the action being logged.
 */
export async function recordAudit(event: AuditEvent): Promise<void> {
  try {
    let metadata = event.metadata ?? {}
    if (JSON.stringify(metadata).length > MAX_METADATA_BYTES) metadata = { truncated: true }
    await db.insert(auditLog).values({
      orgId: event.orgId,
      actorId: event.actor?.id ?? null,
      actorName: event.actor?.name ?? null,
      actorEmail: event.actor?.email ?? null,
      action: event.action,
      targetType: event.target?.type ?? null,
      targetId: event.target?.id ?? null,
      summary: event.summary.slice(0, 500),
      metadata,
      ...(await requestInfo()),
    })
  } catch (error) {
    console.error("[audit] failed to record", event.action, error)
  }
}

/**
 * Shorthand inside `protectedAction` handlers:
 *
 *   await audit(ctx, "customer.deleted", `Deleted ${c.name}`, { target: { type: "customer", id } })
 */
export function audit(
  ctx: { orgId: string; user: { id: string; name: string; email: string } },
  action: string,
  summary: string,
  extra?: Pick<AuditEvent, "target" | "metadata">,
) {
  return recordAudit({ orgId: ctx.orgId, actor: ctx.user, action, summary, ...extra })
}
