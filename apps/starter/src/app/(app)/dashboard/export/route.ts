import { can, requireOrg } from "@templates/auth/guards"
import { parseRange } from "@templates/reports"
import { computeMetrics, metricsToCsv } from "@templates/reports/server"

import { dashboard } from "@/config/dashboard"

export async function GET(request: Request) {
  const { orgId } = await requireOrg()
  const range = parseRange(new URL(request.url).searchParams.get("range"))
  const canSeeActivity = await can({ audit: ["read"] })
  const tiles = dashboard.tiles.filter((m) => canSeeActivity || m.id !== "activity")

  const csv = metricsToCsv(await computeMetrics(tiles, orgId, range))
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="dashboard-${range.preset}-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  })
}
