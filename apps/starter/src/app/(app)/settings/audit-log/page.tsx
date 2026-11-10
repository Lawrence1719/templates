import { auditFacets, auditFilterSchema, listAuditLog } from "@templates/audit"
import { requirePermission } from "@templates/auth/guards"
import { Card, PageHeader } from "@templates/ui/card"
import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { AuditFilters } from "@/components/audit-filters"

export const metadata: Metadata = { title: "Audit log" }

const fmt = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })

export default async function AuditLogPage({ searchParams }: PageProps<"/settings/audit-log">) {
  const { orgId } = await requirePermission({ audit: ["read"] }).catch(() => redirect("/dashboard"))

  const raw = Object.fromEntries(
    Object.entries(await searchParams).map(([k, v]) => [
      k,
      Array.isArray(v) ? v[0] : v || undefined,
    ]),
  )
  const parsed = auditFilterSchema.safeParse(raw)
  const filter = parsed.success ? parsed.data : auditFilterSchema.parse({})
  const [{ rows, total, pages }, facets] = await Promise.all([
    listAuditLog(orgId, filter),
    auditFacets(orgId),
  ])

  const qs = (patch: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...filter, ...patch }))
      if (v !== undefined && v !== "" && !(k === "page" && v === 1)) p.set(k, String(v))
    const s = p.toString()
    return s ? `?${s}` : ""
  }
  const { page: _page, ...exportFilter } = filter

  return (
    // minmax(0,1fr) lets the wide table scroll inside its card instead of stretching the page.
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader
        title="Audit log"
        description="A permanent record of changes in this organization. Entries can't be edited or deleted."
        actions={
          <a
            href={`/settings/audit-log/export${qs({ ...exportFilter, page: undefined })}`}
            className="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium hover:bg-accent"
          >
            Export CSV
          </a>
        }
      />

      <AuditFilters actions={facets.actions} actors={facets.actors} />

      <Card className="overflow-hidden p-0">
        {rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            No entries match these filters.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">When</th>
                  <th className="px-4 py-2.5 font-medium">Who</th>
                  <th className="px-4 py-2.5 font-medium">What</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      <time dateTime={r.createdAt.toISOString()}>{fmt.format(r.createdAt)}</time>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{r.actorName ?? "System"}</p>
                      <p className="text-xs text-muted-foreground">{r.actorEmail}</p>
                    </td>
                    <td className="px-4 py-3">{r.summary}</td>
                    <td className="hidden px-4 py-3 md:table-cell">
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                        {r.action}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <nav className="flex items-center justify-between text-sm" aria-label="Pagination">
        <span className="text-muted-foreground">
          {total} {total === 1 ? "entry" : "entries"} · page {filter.page} of {pages}
        </span>
        <div className="flex gap-2">
          {filter.page > 1 && (
            <Link
              className="rounded-md border px-3 py-1.5 hover:bg-accent"
              href={qs({ page: filter.page - 1 })}
            >
              Previous
            </Link>
          )}
          {filter.page < pages && (
            <Link
              className="rounded-md border px-3 py-1.5 hover:bg-accent"
              href={qs({ page: filter.page + 1 })}
            >
              Next
            </Link>
          )}
        </div>
      </nav>
    </div>
  )
}
