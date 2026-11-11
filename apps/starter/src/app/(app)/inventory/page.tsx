import { can, requirePermission } from "@templates/auth/guards"
import {
  formatMoney,
  formatQuantity,
  inventorySummary,
  listProducts,
  productCategories,
  productFilterSchema,
  reorderList,
  suggestedOrder,
} from "@templates/inventory"
import { Card, PageHeader } from "@templates/ui/card"
import { cn } from "@templates/ui/cn"
import { Plus } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { InventoryTabs, StockBadge } from "@/components/inventory-shared"

export const metadata: Metadata = { title: "Inventory" }

export default async function InventoryPage({ searchParams }: PageProps<"/inventory">) {
  const { orgId } = await requirePermission({ inventory: ["read"] }).catch(() =>
    redirect("/dashboard"),
  )
  const raw = Object.fromEntries(
    Object.entries(await searchParams).map(([k, v]) => [
      k,
      Array.isArray(v) ? v[0] : v || undefined,
    ]),
  )
  const filter = productFilterSchema.parse(raw)
  const [{ rows, total, page, pageSize }, summary, categories, canManage, reorder] =
    await Promise.all([
      listProducts({ orgId }, filter),
      inventorySummary({ orgId }),
      productCategories({ orgId }),
      can({ inventory: ["manage"] }),
      filter.stock === "low" ? reorderList({ orgId }) : Promise.resolve([]),
    ])
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const qs = (patch: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...filter, ...patch }))
      if (
        v !== undefined &&
        v !== "" &&
        !(k === "page" && v === 1) &&
        !(k === "status" && v === "active")
      )
        p.set(k, String(v))
    const s = p.toString()
    return `/inventory${s ? `?${s}` : ""}`
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader
        title="Inventory"
        description="What you stock, where it is and how much is left."
        actions={
          canManage && (
            <Link
              href="/inventory/new"
              className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 [&_svg]:size-4"
            >
              <Plus /> New product
            </Link>
          )
        }
      />
      <InventoryTabs current="/inventory" />

      <dl className="grid gap-3 sm:grid-cols-4">
        {[
          {
            label: "Products",
            value: String(summary.products),
            href: qs({ stock: undefined, page: undefined }),
          },
          {
            label: "Stock value at cost",
            value: summary.value.map((v) => formatMoney(v.cents, v.currency)).join(" + ") || "—",
          },
          {
            label: "Low stock",
            value: String(summary.low),
            href: qs({ stock: "low", page: undefined }),
            warn: summary.low > 0,
          },
          {
            label: "Out of stock",
            value: String(summary.out),
            href: qs({ stock: "out", page: undefined }),
            danger: summary.out > 0,
          },
        ].map((s) => {
          const body = (
            <>
              <dt className={cn("text-xs text-muted-foreground", s.danger && "text-danger")}>
                {s.label}
              </dt>
              <dd className="mt-1 truncate text-xl font-semibold tabular-nums">{s.value}</dd>
            </>
          )
          return s.href ? (
            <Link
              key={s.label}
              href={s.href}
              className="rounded-xl border px-4 py-3 hover:bg-muted/50"
            >
              {body}
            </Link>
          ) : (
            <div key={s.label} className="rounded-xl border px-4 py-3">
              {body}
            </div>
          )
        })}
      </dl>

      <form action="/inventory" className="flex flex-wrap gap-2 [&>*]:min-w-0">
        <input
          type="search"
          name="q"
          defaultValue={filter.q ?? ""}
          aria-label="Search products"
          placeholder="Name, SKU or barcode…"
          className="h-9 basis-full rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:basis-64 sm:grow"
        />
        {categories.length > 0 && (
          <select
            name="category"
            aria-label="Category"
            defaultValue={filter.category ?? ""}
            className="h-9 grow basis-[calc(50%-0.25rem)] rounded-md border bg-transparent px-2 text-sm sm:grow-0 sm:basis-auto"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        )}
        <select
          name="stock"
          aria-label="Stock level"
          defaultValue={filter.stock ?? ""}
          className="h-9 grow basis-[calc(50%-0.25rem)] rounded-md border bg-transparent px-2 text-sm sm:grow-0 sm:basis-auto"
        >
          <option value="">Any stock level</option>
          <option value="low">Low</option>
          <option value="out">Out of stock</option>
        </select>
        <select
          name="status"
          aria-label="Status"
          defaultValue={filter.status}
          className="h-9 grow basis-[calc(50%-0.25rem)] rounded-md border bg-transparent px-2 text-sm sm:grow-0 sm:basis-auto"
        >
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
        <button type="submit" className="h-9 rounded-md border px-4 text-sm hover:bg-accent">
          Filter
        </button>
      </form>

      {filter.stock === "low" && reorder.length > 0 && (
        <Card className="grid gap-2 p-4 text-sm">
          <p className="font-medium">To reorder</p>
          <ul className="grid gap-1 text-muted-foreground">
            {reorder.map((r) => (
              <li key={r.id}>
                <Link href={`/inventory/${r.id}`} className="text-foreground hover:underline">
                  {r.name}
                </Link>{" "}
                · {formatQuantity(r.onHandMilli, r.unit)} left · order{" "}
                {formatQuantity(
                  suggestedOrder(r.onHandMilli, r.reorderPointMilli, r.reorderQtyMilli),
                  r.unit,
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        {rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            {filter.q || filter.stock || filter.category
              ? "No products match."
              : "No products yet."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Product</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Category</th>
                  <th className="px-4 py-2.5 text-right font-medium">On hand</th>
                  <th className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">Price</th>
                  <th className="px-4 py-2.5 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((p) => (
                  <tr key={p.id} className="hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <Link href={`/inventory/${p.id}`} className="font-medium hover:underline">
                        {p.name}
                      </Link>
                      <p className="font-mono text-xs text-muted-foreground">{p.sku}</p>
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                      {p.category ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {formatQuantity(p.onHandMilli, p.unit)}
                    </td>
                    <td className="hidden whitespace-nowrap px-4 py-3 text-right tabular-nums sm:table-cell">
                      {formatMoney(p.priceCents, p.currency)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <StockBadge onHand={p.onHandMilli} reorderPoint={p.reorderPointMilli} />
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
            {total} products · page {page} of {pages}
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
