import { requirePermission } from "@templates/auth/guards"
import {
  formatMoney,
  formatQuantity,
  listSales,
  registerOptions,
  SALE_STATE_LABELS,
  saleState,
  TENDER_LABELS,
  type Tender,
} from "@templates/pos"
import { Card, PageHeader } from "@templates/ui/card"
import { cn } from "@templates/ui/cn"
import { Select } from "@templates/ui/form"
import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

export const metadata: Metadata = { title: "Sales" }

const stamp = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })

export default async function PosSalesPage({ searchParams }: PageProps<"/pos/sales">) {
  const { orgId } = await requirePermission({ pos: ["read"] }).catch(() => redirect("/dashboard"))
  const raw = Object.fromEntries(
    Object.entries(await searchParams).map(([k, v]) => [
      k,
      Array.isArray(v) ? v[0] : v || undefined,
    ]),
  )
  const [{ rows, total, page, pageSize, filter }, registers] = await Promise.all([
    listSales({ orgId }, raw),
    registerOptions({ orgId }),
  ])
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const qs = (patch: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...filter, ...patch }))
      if (v !== undefined && v !== "" && !(k === "page" && v === 1)) p.set(k, String(v))
    const s = p.toString()
    return `/pos/sales${s ? `?${s}` : ""}`
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader title="Sales" description="Every sale rung up at the till, newest first." />
      <form action="/pos/sales" className="flex flex-wrap items-end gap-2 text-sm">
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">Day</span>
          <input
            type="date"
            name="day"
            defaultValue={filter.day ?? ""}
            className="h-9 rounded-md border bg-transparent px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">Register</span>
          <Select name="register" defaultValue={filter.register ?? ""}>
            <option value="">All registers</option>
            {registers.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="grid min-w-0 flex-1 gap-1 sm:flex-none">
          <span className="text-xs text-muted-foreground">Search</span>
          <input
            type="search"
            name="q"
            defaultValue={filter.q ?? ""}
            placeholder="Receipt or customer…"
            className="h-9 w-full rounded-md border bg-transparent px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-56"
          />
        </label>
        <button type="submit" className="h-9 rounded-md border px-4 font-medium hover:bg-accent">
          Filter
        </button>
        {(filter.day || filter.register || filter.q) && (
          <Link
            href="/pos/sales"
            className="h-9 px-2 leading-9 text-muted-foreground hover:underline"
          >
            Clear
          </Link>
        )}
      </form>

      <Card className="overflow-hidden p-0">
        {rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            {filter.day || filter.register || filter.q ? "No sales match." : "No sales yet."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Receipt</th>
                  <th className="px-4 py-2.5 font-medium">When</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Register</th>
                  <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Customer</th>
                  <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Paid by</th>
                  <th className="px-4 py-2.5 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((s) => {
                  const state = saleState(s)
                  return (
                    <tr key={s.id} className="hover:bg-muted/50">
                      <td className="px-4 py-3">
                        <Link
                          href={`/pos/sales/${s.id}`}
                          className="font-mono font-medium hover:underline"
                        >
                          {s.number}
                        </Link>
                        <span className="block text-xs text-muted-foreground">
                          {formatQuantity(s.items)} items
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                        {stamp.format(s.createdAt)}
                      </td>
                      <td className="hidden px-4 py-3 md:table-cell">{s.registerName}</td>
                      <td className="hidden px-4 py-3 lg:table-cell">
                        {s.customerName ?? <span className="text-muted-foreground">Walk-in</span>}
                      </td>
                      <td className="hidden px-4 py-3 sm:table-cell">
                        {(s.tenders ?? "")
                          .split(",")
                          .filter(Boolean)
                          .map((t) => TENDER_LABELS[t as Tender] ?? t)
                          .join(" + ") || "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        {formatMoney(s.totalCents, s.currency)}
                        {state !== "paid" && (
                          <span className={cn("block text-xs", "text-danger")}>
                            {SALE_STATE_LABELS[state]}
                          </span>
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
            {total} sales · page {page} of {pages}
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
