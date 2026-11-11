import { can, requirePermission } from "@templates/auth/guards"
import { listMemberships, listPlans, membershipSummary } from "@templates/memberships"
import { MEMBERSHIP_FILTER_STATES, STATE_LABELS } from "@templates/memberships/definitions"
import { Card, PageHeader } from "@templates/ui/card"
import { cn } from "@templates/ui/cn"
import { Plus, ScanLine } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { StateBadge } from "@/components/memberships"

export const metadata: Metadata = { title: "Memberships" }

const longDay = (d: string) =>
  new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${d}T00:00:00Z`),
  )
const stamp = new Intl.DateTimeFormat("en", { dateStyle: "medium" })

export default async function MembershipsPage({ searchParams }: PageProps<"/memberships">) {
  const { orgId } = await requirePermission({ membership: ["read"] }).catch(() =>
    redirect("/dashboard"),
  )
  const raw = Object.fromEntries(
    Object.entries(await searchParams).map(([k, v]) => [
      k,
      Array.isArray(v) ? v[0] : v || undefined,
    ]),
  )
  const [{ rows, total, page, pageSize, filter }, summary, plans, canSell, canDesk, canManage] =
    await Promise.all([
      listMemberships({ orgId }, raw),
      membershipSummary({ orgId }),
      listPlans({ orgId }),
      can({ membership: ["sell"] }),
      can({ membership: ["checkin"] }),
      can({ membership: ["manage"] }),
    ])
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const qs = (patch: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...filter, ...patch }))
      if (v !== undefined && v !== "" && !(k === "page" && v === 1)) p.set(k, String(v))
    const s = p.toString()
    return `/memberships${s ? `?${s}` : ""}`
  }
  const button =
    "inline-flex h-9 items-center gap-2 rounded-md border px-4 text-sm font-medium hover:bg-accent [&_svg]:size-4"

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader
        title="Memberships"
        description="Plans, renewals and who's coming in."
        actions={
          <div className="flex flex-wrap gap-2">
            {canDesk && (
              <Link href="/memberships/desk" className={button}>
                <ScanLine /> Check-in desk
              </Link>
            )}
            {canManage && (
              <Link href="/memberships/plans" className={button}>
                Plans
              </Link>
            )}
            {canSell && (
              <Link
                href="/memberships/new"
                className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 [&_svg]:size-4"
              >
                <Plus /> New membership
              </Link>
            )}
          </div>
        }
      />

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          {
            label: "Active",
            value: summary.active,
            href: qs({ state: "active", page: undefined }),
          },
          {
            label: `Ending in ${summary.soonDays} days`,
            value: summary.expiring,
            href: qs({ state: "expiring", page: undefined }),
            warn: summary.expiring > 0,
          },
          {
            label: "Lapsed, last 30 days",
            value: summary.lapsed,
            href: qs({ state: "expired", page: undefined }),
          },
          { label: "Visits today", value: summary.visitsToday, href: "/memberships/desk" },
        ].map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="rounded-xl border px-4 py-3 hover:bg-muted/50"
          >
            <dt className={cn("text-xs text-muted-foreground", s.warn && "text-warning")}>
              {s.label}
            </dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{s.value}</dd>
          </Link>
        ))}
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Filter by state" className="flex flex-wrap gap-1.5 text-sm">
          {[undefined, ...MEMBERSHIP_FILTER_STATES].map((s) => (
            <Link
              key={s ?? "all"}
              href={qs({ state: s, page: undefined })}
              aria-current={filter.state === s ? "page" : undefined}
              className={cn(
                "rounded-full border px-3 py-1",
                filter.state === s
                  ? "border-foreground bg-accent font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s ? STATE_LABELS[s] : "All current"}
            </Link>
          ))}
        </nav>
        <form action="/memberships" className="flex flex-wrap gap-2">
          {filter.state && <input type="hidden" name="state" value={filter.state} />}
          <select
            name="plan"
            defaultValue={filter.plan ?? ""}
            aria-label="Plan"
            className="h-9 rounded-md border bg-transparent px-2 text-sm"
          >
            <option value="">All plans</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            type="search"
            name="q"
            defaultValue={filter.q ?? ""}
            aria-label="Search members"
            placeholder="Name, email or phone…"
            className="h-9 w-full rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-56"
          />
        </form>
      </div>

      <Card className="overflow-hidden p-0">
        {rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            {filter.state || filter.q || filter.plan ? "Nobody matches." : "No memberships yet."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Member</th>
                  <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Plan</th>
                  <th className="px-4 py-2.5 font-medium">Until</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Last visit</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((m) => (
                  <tr key={m.id} className="hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <Link href={`/memberships/${m.id}`} className="font-medium hover:underline">
                        {m.customerName}
                      </Link>
                      {m.customerEmail && (
                        <span className="block text-xs text-muted-foreground">
                          {m.customerEmail}
                        </span>
                      )}
                    </td>
                    <td className="hidden px-4 py-3 sm:table-cell">{m.planName}</td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                      {longDay(m.periodEnd)}
                      {m.autoRenew && m.status === "active" && (
                        <span className="block text-xs text-muted-foreground">
                          renews automatically
                        </span>
                      )}
                    </td>
                    <td className="hidden whitespace-nowrap px-4 py-3 text-muted-foreground md:table-cell">
                      {m.lastVisit ? stamp.format(m.lastVisit) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <StateBadge state={m.state} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {total > pageSize && (
        <nav className="flex items-center justify-between text-sm" aria-label="Pagination">
          <span className="text-muted-foreground">
            {total} memberships · page {page} of {pages}
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
