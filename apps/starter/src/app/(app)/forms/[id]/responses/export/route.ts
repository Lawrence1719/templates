import { AuthError, requirePermission } from "@templates/auth/guards"
import { FormError, submissionsCsv } from "@templates/forms"

export async function GET(_req: Request, { params }: RouteContext<"/forms/[id]/responses/export">) {
  let ctx: Awaited<ReturnType<typeof requirePermission>>
  try {
    ctx = await requirePermission({ response: ["read"] })
  } catch (e) {
    return new Response("Forbidden", { status: e instanceof AuthError ? e.status : 403 })
  }
  try {
    const csv = await submissionsCsv(ctx, (await params).id)
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="responses-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (e) {
    if (e instanceof FormError) return new Response("Not found", { status: 404 })
    throw e
  }
}
