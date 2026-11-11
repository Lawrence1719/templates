import { AuthError, requirePermission } from "@templates/auth/guards"
import { movementsCsv } from "@templates/inventory"

export async function GET(req: Request) {
  let ctx: Awaited<ReturnType<typeof requirePermission>>
  try {
    ctx = await requirePermission({ inventory: ["read"] })
  } catch (e) {
    return new Response("Forbidden", { status: e instanceof AuthError ? e.status : 403 })
  }
  const filter = Object.fromEntries(new URL(req.url).searchParams)
  const csv = await movementsCsv({ orgId: ctx.orgId }, filter)
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="stock-movements-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  })
}
