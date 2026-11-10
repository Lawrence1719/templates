import { audit, auditFilterSchema, exportAuditCsv } from "@templates/audit"
import { AuthError, requirePermission } from "@templates/auth/guards"

export async function GET(request: Request) {
  let ctx: Awaited<ReturnType<typeof requirePermission>>
  try {
    ctx = await requirePermission({ audit: ["read"] })
  } catch (e) {
    return new Response("Forbidden", { status: e instanceof AuthError ? e.status : 403 })
  }

  const params = Object.fromEntries(new URL(request.url).searchParams)
  const parsed = auditFilterSchema.omit({ page: true }).safeParse(params)
  if (!parsed.success) return new Response("Invalid filters", { status: 400 })

  const csv = await exportAuditCsv(ctx.orgId, parsed.data)
  // Exports are sensitive themselves, so they're logged too.
  await audit(ctx, "audit_log.exported", "Exported the audit log", { metadata: parsed.data })

  const date = new Date().toISOString().slice(0, 10)
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-log-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  })
}
