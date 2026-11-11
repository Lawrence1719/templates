import { requirePermission } from "@templates/auth/guards"
import {
  formatQuantity,
  KIND_LABELS,
  listLocations,
  listMovements,
  MOVEMENT_KINDS,
  REASON_LABELS,
} from "@templates/inventory"
import { Card, PageHeader } from "@templates/ui/card"
import { cn } from "@templates/ui/cn"
import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { InventoryTabs } from "@/components/inventory-shared"

export const metadata: Metadata = { title: "Stock movements" }

const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })
const field = "h-9 rounded-md border bg-transparent px-2 text-sm"

export default async function MovementsPage({ searchParams }: PageProps<"/inventory/movements">) {
  const { orgId } = await requirePermission({ inventory: ["read"] }).catch(() =>
    redirect("/dashboard"),
  )
  const raw = Object.fromEntries(
    Object.entries(await searchParams).map(([k, v]) => [
      k,
      Array.isArray(v) ? v[0] : v || undefined,
    ]),
  )
  const [{ rows, total, page, pageSize, filter }, locations] = await Promise.all([
    listMovements({ orgId }, raw),
    listLocations({ orgId }, { includeArchived: true }),
  ])
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const qs = (
    patch: Record<string, string | number | undefined>,
    base = "/inventory/movements",
  ) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...filter, ...patch }))
      if (v !== undefined && v !== "" && !(k === "page" && v === 1)) p.set(k, String(v))
    const s = p.toString()
    return `${base}${s ? `?${s}` : ""}`
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader
        title="Inventory"
        description="Every change to stock, in order. Entries can't be edited; corrections are new entries."
        actions={
          <a
            href={qs({ page: undefined }, "/inventory/movements/export")}
            className="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium hover:bg-accent"
          >
            Export CSV
          </a>
        }
      />
      <InventoryTabs current="/inventory/movements" />

      <form action="/inventory/movements" className="flex flex-wrap gap-2 [&>*]:min-w-0">
        {filter.product && <input type="hidden" name="product" value={filter.product} />}
        <select
          name="location"
          aria-label="Location"
          defaultValue={filter.location ?? ""}
          className={field}
        >
          <option value="">All locations</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <select name="kind" aria-label="Type" defaultValue={filter.kind ?? ""} className={field}>
          <option value="">All types</option>
          {MOVEMENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <input
          type="date"
          name="from"
          aria-label="From"
          defaultValue={filter.from ?? ""}
          className={field}
        />
        <input
          type="date"
          name="to"
          aria-label="To"
          defaultValue={filter.to ?? ""}
          className={field}
        />
        <button type="submit" className="h-9 rounded-md border px-4 text-sm hover:bg-accent">
          Filter
        </button>
        {(filter.product || filter.location || filter.kind || filter.from || filter.to) && (
          <Link
            href="/inventory/movements"
            className="inline-flex h-9 items-center px-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Clear
          </Link>
        )}
      </form>

      <Card className="overflow-hidden p-0">
        {rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No movements match.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">When</th>
                  <th className="px-4 py-2.5 font-medium">Product</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Location</th>
                  <th className="px-4 py-2.5 font-medium">Type</th>
                  <th className="px-4 py-2.5 text-right font-medium">Change</th>
                  <th className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">After</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((m) => (
                  <tr key={m.id} className="align-top">
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      <time dateTime={m.createdAt.toISOString()}>{when.format(m.createdAt)}</time>
                      {m.byName && <span className="block text-xs">{m.byName}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/inventory/${m.productId}`}
                        className="font-medium hover:underline"
                      >
                        {m.productName}
                      </Link>
                      <span className="block font-mono text-xs text-muted-foreground">{m.sku}</span>
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell">{m.locationName}</td>
                    <td className="px-4 py-3">
                      {KIND_LABELS[m.kind]}
                      {m.reason && (
                        <span className="block text-xs text-muted-foreground">
                          {REASON_LABELS[m.reason as keyof typeof REASON_LABELS] ?? m.reason}
                        </span>
                      )}
                      {m.reference && (
                        <span className="block font-mono text-xs text-muted-foreground">
                          {m.reference}
                        </span>
                      )}
                    </td>
                    <td
                      className={cn(
                        "whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums",
                        m.quantityMilli > 0 && "text-success",
                        m.quantityMilli < 0 && "text-danger",
                      )}
                    >
                      {m.quantityMilli > 0 ? "+" : m.quantityMilli < 0 ? "−" : "±"}
                      {formatQuantity(Math.abs(m.quantityMilli), m.unit)}
                    </td>
                    <td className="hidden whitespace-nowrap px-4 py-3 text-right tabular-nums text-muted-foreground sm:table-cell">
                      {formatQuantity(m.balanceAfterMilli, m.unit)}
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
            {total} movements · page {page} of {pages}
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
