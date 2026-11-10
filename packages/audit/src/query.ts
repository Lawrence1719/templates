import "server-only"

import { db } from "@templates/db"
import { auditLog } from "@templates/db/schema"
import { and, count, desc, eq, gte, ilike, lt, or, type SQL } from "drizzle-orm"
import { z } from "zod"

export const auditFilterSchema = z.object({
  action: z.string().max(100).optional(),
  actor: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
})
export type AuditFilter = z.infer<typeof auditFilterSchema>

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

/** orgId is required and always applied — callers pass the session's org, never user input. */
function where(orgId: string, f: Omit<AuditFilter, "page">) {
  const conds: SQL[] = [eq(auditLog.orgId, orgId)]
  if (f.action) conds.push(eq(auditLog.action, f.action))
  if (f.actor) conds.push(eq(auditLog.actorId, f.actor))
  if (f.from) conds.push(gte(auditLog.createdAt, new Date(`${f.from}T00:00:00Z`)))
  if (f.to) {
    const end = new Date(`${f.to}T00:00:00Z`)
    end.setUTCDate(end.getUTCDate() + 1)
    conds.push(lt(auditLog.createdAt, end))
  }
  if (f.q) {
    const term = `%${escapeLike(f.q)}%`
    const match = or(ilike(auditLog.summary, term), ilike(auditLog.actorEmail, term))
    if (match) conds.push(match)
  }
  return and(...conds)
}

export const PAGE_SIZE = 25

export async function listAuditLog(orgId: string, filter: AuditFilter) {
  const w = where(orgId, filter)
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(auditLog)
      .where(w)
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(PAGE_SIZE)
      .offset((filter.page - 1) * PAGE_SIZE),
    db.select({ n: count() }).from(auditLog).where(w),
  ])
  const n = total?.n ?? 0
  return { rows, total: n, pages: Math.max(1, Math.ceil(n / PAGE_SIZE)) }
}

/** Distinct actions and actors for the filter dropdowns. */
export async function auditFacets(orgId: string) {
  const [actions, actors] = await Promise.all([
    db
      .selectDistinct({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.orgId, orgId))
      .orderBy(auditLog.action),
    db
      .selectDistinct({ id: auditLog.actorId, email: auditLog.actorEmail })
      .from(auditLog)
      .where(eq(auditLog.orgId, orgId)),
  ])
  return {
    actions: actions.map((a) => a.action),
    actors: actors.filter((a): a is { id: string; email: string } => !!a.id && !!a.email),
  }
}

const MAX_EXPORT_ROWS = 50_000

/** CSV of every row matching the filter (capped). Cells are escaped against formula injection. */
export async function exportAuditCsv(orgId: string, filter: Omit<AuditFilter, "page">) {
  const rows = await db
    .select()
    .from(auditLog)
    .where(where(orgId, filter))
    .orderBy(desc(auditLog.createdAt))
    .limit(MAX_EXPORT_ROWS)

  const cell = (v: unknown) => {
    let s = v == null ? "" : typeof v === "string" ? v : JSON.stringify(v)
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}` // stop spreadsheets executing it
    return `"${s.replace(/"/g, '""')}"`
  }
  const head = [
    "time",
    "actor_email",
    "action",
    "summary",
    "target_type",
    "target_id",
    "ip",
    "metadata",
  ]
  const lines = rows.map((r) =>
    [
      r.createdAt.toISOString(),
      r.actorEmail,
      r.action,
      r.summary,
      r.targetType,
      r.targetId,
      r.ip,
      r.metadata,
    ]
      .map(cell)
      .join(","),
  )
  return [head.join(","), ...lines].join("\n")
}
