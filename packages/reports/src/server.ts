import "server-only"

import { db } from "@templates/db"
import { auditLog, invitation, member, user } from "@templates/db/schema"
import { and, count, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm"
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core"

import { formatValue } from "./format"
import { type DateRange, rangeDays } from "./range"
import type { Breakdown, ComputedMetric, Metric, Point } from "./types"

/**
 * Daily counts of rows whose `dateCol` falls in [from, to), zero-filled.
 * The caller supplies the org filter so tenant scoping stays explicit.
 */
export async function dailyCounts(
  table: PgTable,
  dateCol: AnyPgColumn,
  orgFilter: ReturnType<typeof eq>,
  range: Pick<DateRange, "from" | "to" | "days">,
): Promise<Point[]> {
  const day = sql<string>`to_char(date_trunc('day', ${dateCol} at time zone 'UTC'), 'YYYY-MM-DD')`
  const rows = await db
    .select({ day, n: count() })
    .from(table)
    .where(and(orgFilter, gte(dateCol, range.from), lt(dateCol, range.to)))
    .groupBy(day)
  const byDay = new Map(rows.map((r) => [r.day, r.n]))
  return rangeDays(range).map((date) => ({ date, value: byDay.get(date) ?? 0 }))
}

const sum = (s: Point[]) => s.reduce((a, p) => a + p.value, 0)
const prevRange = (r: DateRange) => ({ from: r.previousFrom, to: r.from, days: r.days })

/** "New X in period" metric from any org-scoped table with a timestamp. */
export function countMetric(opts: {
  id: string
  label: string
  table: PgTable
  dateCol: AnyPgColumn
  orgCol: AnyPgColumn
  goodDirection?: Metric["goodDirection"]
  hint?: string
}): Metric {
  return {
    id: opts.id,
    label: opts.label,
    goodDirection: opts.goodDirection,
    hint: opts.hint,
    async compute(orgId, range) {
      const f = eq(opts.orgCol, orgId)
      const [series, previous] = await Promise.all([
        dailyCounts(opts.table, opts.dateCol, f, range),
        dailyCounts(opts.table, opts.dateCol, f, prevRange(range)),
      ])
      return { value: sum(series), previous: sum(previous), series }
    },
  }
}

// ---------- Built-in metrics (from the auth and audit modules) ----------

export const membersMetric: Metric = {
  id: "members",
  label: "Members",
  hint: "Total at end of period",
  async compute(orgId, range) {
    const joins = await dailyCounts(
      member,
      member.createdAt,
      eq(member.organizationId, orgId),
      range,
    )
    const [before] = await db
      .select({ n: count() })
      .from(member)
      .where(and(eq(member.organizationId, orgId), lt(member.createdAt, range.from)))
    // Running total; `previous` is the total at the end of the previous period.
    // (Removed members aren't kept, so history reflects current members.)
    let total = before?.n ?? 0
    const series = joins.map((p) => ({ date: p.date, value: (total += p.value) }))
    return { value: total, previous: before?.n ?? 0, series }
  },
}

export const newMembersMetric = countMetric({
  id: "new-members",
  label: "New members",
  table: member,
  dateCol: member.createdAt,
  orgCol: member.organizationId,
})

export const invitesMetric = countMetric({
  id: "invites",
  label: "Invitations sent",
  table: invitation,
  dateCol: invitation.createdAt,
  orgCol: invitation.organizationId,
})

export const activityMetric = countMetric({
  id: "activity",
  label: "Activity",
  hint: "Logged changes",
  table: auditLog,
  dateCol: auditLog.createdAt,
  orgCol: auditLog.orgId,
  goodDirection: "neutral",
})

export const activityByAction: Breakdown = {
  id: "activity-by-action",
  label: "Activity by type",
  async compute(orgId, range) {
    const rows = await db
      .select({ label: auditLog.action, value: count() })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.orgId, orgId),
          gte(auditLog.createdAt, range.from),
          lt(auditLog.createdAt, range.to),
        ),
      )
      .groupBy(auditLog.action)
      .orderBy(desc(count()))
      .limit(8)
    return rows
  },
}

export const mostActivePeople: Breakdown = {
  id: "most-active",
  label: "Most active people",
  async compute(orgId, range) {
    return db
      .select({
        label: sql<string>`coalesce(${user.name}, ${auditLog.actorName}, ${auditLog.actorEmail})`,
        value: count(),
      })
      .from(auditLog)
      .leftJoin(user, eq(user.id, auditLog.actorId))
      .where(
        and(
          eq(auditLog.orgId, orgId),
          isNotNull(auditLog.actorId),
          gte(auditLog.createdAt, range.from),
          lt(auditLog.createdAt, range.to),
        ),
      )
      .groupBy(user.name, auditLog.actorName, auditLog.actorEmail)
      .orderBy(desc(count()))
      .limit(5)
  },
}

/** Latest audit entries for an activity feed. */
export async function recentActivity(orgId: string, limit = 8) {
  return db
    .select({
      id: auditLog.id,
      summary: auditLog.summary,
      actorName: auditLog.actorName,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(eq(auditLog.orgId, orgId))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit)
}

// ---------- Running metrics ----------

export async function computeMetrics(
  metrics: Metric[],
  orgId: string,
  range: DateRange,
): Promise<ComputedMetric[]> {
  return Promise.all(
    metrics.map(async ({ compute, ...meta }) => ({ ...meta, ...(await compute(orgId, range)) })),
  )
}

export async function computeBreakdowns(breakdowns: Breakdown[], orgId: string, range: DateRange) {
  return Promise.all(
    breakdowns.map(async (b) => ({
      id: b.id,
      label: b.label,
      rows: await b.compute(orgId, range),
    })),
  )
}

/** One row per day, one column per metric. Cells escaped against spreadsheet formulas. */
export function metricsToCsv(metrics: ComputedMetric[]) {
  const cell = (v: string | number) => {
    let s = String(v)
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
    return `"${s.replace(/"/g, '""')}"`
  }
  const head = ["date", ...metrics.map((m) => m.label)].map(cell).join(",")
  const days = metrics[0]?.series.map((p) => p.date) ?? []
  const lines = days.map((d, i) =>
    [d, ...metrics.map((m) => m.series[i]?.value ?? 0)].map(cell).join(","),
  )
  const totals = ["total", ...metrics.map((m) => formatValue(m.value, m.format))]
    .map(cell)
    .join(",")
  return [head, ...lines, totals].join("\n")
}
