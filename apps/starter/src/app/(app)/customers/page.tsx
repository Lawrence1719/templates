import { requirePermission } from "@templates/auth/guards"
import { customerFilterSchema, customerTags, listCustomers } from "@templates/crm"
import { Card, PageHeader } from "@templates/ui/card"
import { Building2, Plus, UserRound } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { CustomerFilters } from "@/components/crm"
import { StatusBadge, Tags } from "@/components/crm-badges"
import { timeAgo } from "@/components/time-ago"

export const metadata: Metadata = { title: "Customers" }

export default async function CustomersPage({ searchParams }: PageProps<"/customers">) {
  const { orgId, user } = await requirePermission({ customer: ["read"] }).catch(() =>
    redirect("/dashboard"),
  )
  const raw = Object.fromEntries(
    Object.entries(await searchParams).map(([k, v]) => [
      k,
      Array.isArray(v) ? v[0] : v || undefined,
    ]),
  )
  const filter = customerFilterSchema.parse(raw)
  const [{ rows, total, page, pageSize }, tags] = await Promise.all([
    listCustomers({ orgId, userId: user.id }, filter),
    customerTags({ orgId }),
  ])
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const filtered = !!(filter.q || filter.status || filter.owner || filter.tag)

  const qs = (patch: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...filter, ...patch }))
      if (v !== undefined && v !== "" && !(k === "page" && v === 1)) p.set(k, String(v))
    const s = p.toString()
    return s ? `?${s}` : ""
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader
        title="Customers"
        description="Companies and people you sell to, with their contacts, deals and history."
        actions={
          <div className="flex gap-2">
            <a
              href={`/customers/export${qs({ page: undefined })}`}
              className="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium hover:bg-accent"
            >
              Export CSV
            </a>
            <Link
              href="/customers/new"
              className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 [&_svg]:size-4"
            >
              <Plus /> New customer
            </Link>
          </div>
        }
      />

      <CustomerFilters tags={tags} />

      <Card className="overflow-hidden p-0">
        {rows.length === 0 ? (
          <div className="grid justify-items-center gap-2 p-10 text-center text-sm text-muted-foreground">
            {filtered ? (
              <p>No customers match these filters.</p>
            ) : (
              <>
                <p className="font-medium text-foreground">No customers yet</p>
                <p>Add the companies and people you work with to track deals and conversations.</p>
              </>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Owner</th>
                  <th className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">
                    Open deals
                  </th>
                  <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((c) => {
                  const Icon = c.kind === "company" ? Building2 : UserRound
                  return (
                    <tr key={c.id} className="align-top hover:bg-muted/50">
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-2.5">
                          <Icon
                            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                            aria-label={c.kind === "company" ? "Company" : "Person"}
                          />
                          <div className="grid min-w-0 gap-1">
                            <Link
                              href={`/customers/${c.id}`}
                              className="font-medium hover:underline"
                            >
                              {c.name}
                            </Link>
                            {(c.email || c.phone) && (
                              <span className="truncate text-xs text-muted-foreground">
                                {[c.email, c.phone].filter(Boolean).join(" · ")}
                              </span>
                            )}
                            <Tags tags={c.tags} />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="hidden px-4 py-3 md:table-cell">
                        {c.ownerName ?? <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">
                        {c.openDeals || <span className="text-muted-foreground">0</span>}
                      </td>
                      <td className="hidden whitespace-nowrap px-4 py-3 text-muted-foreground lg:table-cell">
                        {timeAgo(c.updatedAt)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {total > 0 && (
        <nav className="flex items-center justify-between text-sm" aria-label="Pagination">
          <span className="text-muted-foreground">
            {total} {total === 1 ? "customer" : "customers"} · page {page} of {pages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                className="rounded-md border px-3 py-1.5 hover:bg-accent"
                href={qs({ page: page - 1 })}
              >
                Previous
              </Link>
            )}
            {page < pages && (
              <Link
                className="rounded-md border px-3 py-1.5 hover:bg-accent"
                href={qs({ page: page + 1 })}
              >
                Next
              </Link>
            )}
          </div>
        </nav>
      )}
    </div>
  )
}
