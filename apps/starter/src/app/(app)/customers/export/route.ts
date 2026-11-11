import { AuthError, requirePermission } from "@templates/auth/guards"
import { customerFilterSchema, customersCsv } from "@templates/crm"

export async function GET(req: Request) {
  let ctx: Awaited<ReturnType<typeof requirePermission>>
  try {
    ctx = await requirePermission({ customer: ["read"] })
  } catch (e) {
    return new Response("Forbidden", { status: e instanceof AuthError ? e.status : 403 })
  }
  const filter = customerFilterSchema.parse(Object.fromEntries(new URL(req.url).searchParams))
  const csv = await customersCsv({ orgId: ctx.orgId, userId: ctx.user.id }, filter)
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="customers-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  })
}
