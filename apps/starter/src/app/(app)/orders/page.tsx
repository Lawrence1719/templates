import { can, requirePermission } from "@templates/auth/guards"
import {
  formatMoney,
  listOrders,
  ORDER_STATUSES,
  orderSummary,
  STATUS_LABELS,
  today,
} from "@templates/orders"
import { Card, PageHeader } from "@templates/ui/card"
import { cn } from "@templates/ui/cn"
import { Plus } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { formatDay } from "@/components/invoice-document"
import { OrderBadge } from "@/components/order-badge"

export const metadata: Metadata = { title: "Orders" }

const sum = (rows: { currency: string; cents: number }[]) =>
  rows.length ? rows.map((r) => formatMoney(r.cents, r.currency)).join(" + ") : "—"

export default async function OrdersPage({ searchParams }: PageProps<"/orders">) {
  const { orgId } = await requirePermission({ order: ["read"] }).catch(() => redirect("/dashboard"))
  const raw = Object.fromEntries(
    Object.entries(await searchParams).map(([k, v]) => [
      k,
      Array.isArray(v) ? v[0] : v || undefined,
    ]),
  )
  const t = today()
  const [{ rows, total, page, pageSize, filter }, summary, canWrite] = await Promise.all([
    listOrders({ orgId }, raw, t),
    orderSummary({ orgId }, t),
    can({ order: ["write"] }),
  ])
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const qs = (patch: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...filter, ...patch }))
      if (v !== undefined && v !== "" && !(k === "page" && v === 1)) p.set(k, String(v))
    const s = p.toString()
    return `/orders${s ? `?${s}` : ""}`
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader
        title="Orders"
        description="From request to delivery: confirm, ship from stock, invoice."
        actions={
          canWrite && (
            <Link
              href={`/orders/new${filter.customer ? `?customer=${filter.customer}` : ""}`}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 [&_svg]:size-4"
            >
              <Plus /> New order
            </Link>
          )
        }
      />

      <dl className="grid gap-3 sm:grid-cols-3">
        {[
          {
            label: `Open orders · ${summary.open.reduce((n, r) => n + r.n, 0)}`,
            value: sum(summary.open),
            href: qs({ status: "confirmed", due: undefined, page: undefined }),
          },
          {
            label: "Due to ship",
            value: String(summary.due),
            href: qs({ due: "1", status: undefined, page: undefined }),
            danger: summary.due > 0,
          },
          {
            label: "Fulfilled, last 30 days",
            value: sum(summary.fulfilled),
            href: qs({ status: "fulfilled", due: undefined, page: undefined }),
          },
        ].map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="rounded-xl border px-4 py-3 hover:bg-muted/50"
          >
            <dt className={cn("text-xs text-muted-foreground", s.danger && "text-danger")}>
              {s.label}
            </dt>
            <dd className="mt-1 truncate text-xl font-semibold tabular-nums">{s.value}</dd>
          </Link>
        ))}
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Filter by status" className="flex flex-wrap gap-1.5 text-sm">
          {[undefined, ...ORDER_STATUSES].map((s) => (
            <Link
              key={s ?? "all"}
              href={qs({ status: s, due: undefined, page: undefined })}
              aria-current={filter.status === s && !filter.due ? "page" : undefined}
              className={cn(
                "rounded-full border px-3 py-1",
                filter.status === s && !filter.due
                  ? "border-foreground bg-accent font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s ? STATUS_LABELS[s] : "All"}
            </Link>
          ))}
        </nav>
        <form action="/orders" className="flex min-w-0 flex-1 justify-end sm:flex-none">
          {filter.status && <input type="hidden" name="status" value={filter.status} />}
          <input
            type="search"
            name="q"
            defaultValue={filter.q ?? ""}
            aria-label="Search by number or customer"
            placeholder="Number or customer…"
            className="h-9 w-full rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-56"
          />
        </form>
      </div>

      <Card className="overflow-hidden p-0">
        {rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            {filter.status || filter.q || filter.due || filter.customer
              ? "No orders match."
              : "No orders yet."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Order</th>
                  <th className="px-4 py-2.5 font-medium">Customer</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Ordered</th>
                  <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Wanted by</th>
                  <th className="px-4 py-2.5 text-right font-medium">Total</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Invoice</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((o) => {
                  const due = o.status === "confirmed" && !!o.requestedOn && o.requestedOn <= t
                  return (
                    <tr key={o.id} className="hover:bg-muted/50">
                      <td className="px-4 py-3">
                        <Link
                          href={`/orders/${o.id}`}
                          className="font-mono font-medium hover:underline"
                        >
                          {o.number}
                        </Link>
                      </td>
                      <td className="px-4 py-3">{o.customerName}</td>
                      <td className="hidden whitespace-nowrap px-4 py-3 text-muted-foreground md:table-cell">
                        {formatDay(o.orderDate)}
                      </td>
                      <td
                        className={cn(
                          "hidden whitespace-nowrap px-4 py-3 text-muted-foreground sm:table-cell",
                          due && "text-danger",
                        )}
                      >
                        {o.requestedOn ? formatDay(o.requestedOn) : "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        {formatMoney(o.totalCents, o.currency)}
                      </td>
                      <td className="px-4 py-3">
                        <OrderBadge status={o.status} due={due} />
                      </td>
                      <td className="hidden px-4 py-3 lg:table-cell">
                        {o.invoiceId ? (
                          <Link
                            href={`/invoices/${o.invoiceId}`}
                            className="text-xs hover:underline"
                          >
                            {o.invoiceNumber ?? "Draft"}
                            {o.invoicePaid && <span className="ml-1 text-success">· paid</span>}
                          </Link>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {total > pageSize && (
        <nav className="flex items-center justify-between text-sm" aria-label="Pagination">
          <span className="text-muted-foreground">
            {total} orders · page {page} of {pages}
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
