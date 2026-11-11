import { AuthError, requirePermission } from "@templates/auth/guards"
import { timesheetCsv } from "@templates/hr"
import { isDay } from "@templates/hr/definitions"

export async function GET(req: Request) {
  let ctx: Awaited<ReturnType<typeof requirePermission>>
  try {
    ctx = await requirePermission({ hr: ["read"] })
  } catch (e) {
    return new Response("Forbidden", { status: e instanceof AuthError ? e.status : 403 })
  }
  const w = new URL(req.url).searchParams.get("week") ?? undefined
  const week = w && isDay(w) ? w : undefined
  const csv = await timesheetCsv({ orgId: ctx.orgId }, week)
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="timesheet-${week ?? "this-week"}.csv"`,
      "Cache-Control": "no-store",
    },
  })
}
