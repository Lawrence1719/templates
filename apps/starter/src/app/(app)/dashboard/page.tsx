import { can, requireOrg } from "@templates/auth/guards"
import { parseRange } from "@templates/reports"
import { computeBreakdowns, computeMetrics, recentActivity } from "@templates/reports/server"
import {
  ActivityFeed,
  BarList,
  RangePicker,
  StatTile,
  TrendChart,
} from "@templates/reports/widgets"
import { PageHeader } from "@templates/ui/card"
import type { Metadata } from "next"

import { dashboard } from "@/config/dashboard"

export const metadata: Metadata = { title: "Dashboard" }

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const { user, orgId } = await requireOrg()
  const range = parseRange((await searchParams).range)
  const canSeeActivity = await can({ audit: ["read"] })

  // Activity data comes from the audit log, so only roles allowed to read it see it.
  const tiles = dashboard.tiles.filter((m) => canSeeActivity || m.id !== "activity")
  const [metrics, breakdowns, recent] = await Promise.all([
    computeMetrics(tiles, orgId, range),
    canSeeActivity ? computeBreakdowns(dashboard.breakdowns, orgId, range) : [],
    canSeeActivity ? recentActivity(orgId) : [],
  ])
  const trend = metrics.find((m) => m.id === dashboard.trend) ?? metrics[0]
  const period = `${range.days} days`

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader
        title={`Welcome back, ${user.name.split(" ")[0]}`}
        description={`Last ${period}, compared with the ${period} before.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <RangePicker value={range.preset} basePath="/dashboard" />
            <a
              href={`/dashboard/export?range=${range.preset}`}
              className="inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium hover:bg-accent"
            >
              Export CSV
            </a>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((m) => (
          <StatTile key={m.id} metric={m} periodLabel={period} />
        ))}
      </div>

      {trend && <TrendChart metric={trend} />}

      {canSeeActivity && (
        <div className="grid gap-4 lg:grid-cols-3">
          {breakdowns.map((b) => (
            <BarList key={b.id} title={b.label} rows={b.rows} empty="No activity in this period." />
          ))}
          <ActivityFeed items={recent} moreHref="/settings/audit-log" />
        </div>
      )}
    </div>
  )
}
