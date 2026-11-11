import { can, requirePermission } from "@templates/auth/guards"
import {
  formatMoney,
  formatQuantity,
  getProduct,
  InventoryError,
  KIND_LABELS,
  REASON_LABELS,
  stockValue,
} from "@templates/inventory"
import { Card } from "@templates/ui/card"
import { cn } from "@templates/ui/cn"
import { Pencil } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { ProductStatusActions, StockActions } from "@/components/inventory"
import { StockBadge } from "@/components/inventory-shared"
import { timeAgo } from "@/components/time-ago"

export const metadata: Metadata = { title: "Product" }

const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })

export default async function ProductPage({ params }: PageProps<"/inventory/[id]">) {
  const { id } = await params
  const ctx = await requirePermission({ inventory: ["read"] }).catch(() => redirect("/dashboard"))
  const data = await getProduct(ctx, id).catch((e) => {
    if (e instanceof InventoryError) notFound()
    throw e
  })
  const { product: p, levels, movements, onHandMilli } = data
  const [canMove, canCount, canManage] = await Promise.all([
    can({ inventory: ["move"] }),
    can({ inventory: ["adjust"] }),
    can({ inventory: ["manage"] }),
  ])
  const archived = p.status === "archived"

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <Link href="/inventory" className="text-sm text-muted-foreground hover:text-foreground">
            ← Inventory
          </Link>
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">
            {p.name}
            <StockBadge onHand={onHandMilli} reorderPoint={p.reorderPointMilli} />
            {archived && (
              <span className="rounded-full border px-2 py-0.5 text-xs font-normal text-muted-foreground">
                Archived
              </span>
            )}
          </h1>
          <p className="font-mono text-sm text-muted-foreground">
            {p.sku}
            {p.barcode && ` · ${p.barcode}`}
            {p.category && <span className="font-sans"> · {p.category}</span>}
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/inventory/${p.id}/edit`}
              className="inline-flex h-9 items-center gap-2 rounded-md border px-4 text-sm font-medium hover:bg-accent [&_svg]:size-4"
            >
              <Pencil /> Edit
            </Link>
            <ProductStatusActions
              id={p.id}
              sku={p.sku}
              archived={archived}
              canDelete={movements.length === 0}
            />
          </div>
        )}
      </div>

      <dl className="grid gap-3 sm:grid-cols-4">
        {[
          ["On hand", formatQuantity(onHandMilli, p.unit)],
          ["Value at cost", formatMoney(stockValue(onHandMilli, p.costCents), p.currency)],
          [
            "Cost / price",
            `${formatMoney(p.costCents, p.currency)} / ${formatMoney(p.priceCents, p.currency)}`,
          ],
          [
            "Reorder at",
            p.reorderPointMilli ? formatQuantity(p.reorderPointMilli, p.unit) : "No alert",
          ],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border px-4 py-3">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 truncate text-lg font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid gap-4">
          {canMove && (
            <Card className="p-5">
              <StockActions
                productId={p.id}
                unit={p.unit}
                canCount={canCount}
                archived={archived}
                locations={levels.map((l) => ({
                  id: l.locationId,
                  name: l.locationName,
                  quantityMilli: l.quantityMilli,
                  active: l.locationStatus === "active",
                }))}
              />
            </Card>
          )}
          <Card className="p-0">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <h2 className="text-sm font-semibold">History</h2>
              <Link
                href={`/inventory/movements?product=${p.id}`}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Full ledger →
              </Link>
            </div>
            {movements.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                No stock movements yet.
              </p>
            ) : (
              <ol className="divide-y">
                {movements.map((m) => (
                  <li
                    key={m.id}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-5 py-3 text-sm"
                  >
                    <span
                      className={cn(
                        "w-20 shrink-0 text-right font-medium tabular-nums",
                        m.quantityMilli > 0 && "text-success",
                        m.quantityMilli < 0 && "text-danger",
                      )}
                    >
                      {m.quantityMilli > 0 ? "+" : m.quantityMilli < 0 ? "−" : "±"}
                      {formatQuantity(Math.abs(m.quantityMilli))}
                    </span>
                    <span className="min-w-0 flex-1">
                      {KIND_LABELS[m.kind]}
                      {m.reason &&
                        ` · ${REASON_LABELS[m.reason as keyof typeof REASON_LABELS] ?? m.reason}`}{" "}
                      · {m.locationName}
                      {m.reference && (
                        <span className="font-mono text-xs text-muted-foreground">
                          {" "}
                          {m.reference}
                        </span>
                      )}
                      {m.note && (
                        <span className="block text-xs text-muted-foreground">{m.note}</span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatQuantity(m.balanceAfterMilli, p.unit)} after ·{" "}
                      <time dateTime={m.createdAt.toISOString()} title={when.format(m.createdAt)}>
                        {timeAgo(m.createdAt)}
                      </time>
                      {m.byName && ` · ${m.byName}`}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <Card className="grid gap-3 p-5">
          <h2 className="text-sm font-semibold">By location</h2>
          {levels.length === 0 ? (
            <p className="text-sm text-muted-foreground">No locations yet.</p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {levels.map((l) => (
                <li key={l.locationId} className="flex justify-between gap-3">
                  <span className={cn(l.locationStatus !== "active" && "text-muted-foreground")}>
                    {l.locationName}
                  </span>
                  <span className="tabular-nums">{formatQuantity(l.quantityMilli, p.unit)}</span>
                </li>
              ))}
            </ul>
          )}
          {p.description && (
            <p className="border-t pt-3 text-sm whitespace-pre-line text-muted-foreground">
              {p.description}
            </p>
          )}
        </Card>
      </div>
    </div>
  )
}
