import { can, requirePermission } from "@templates/auth/guards"
import { formatQuantity } from "@templates/inventory/definitions"
import { invoiceState, STATE_LABELS } from "@templates/invoicing/definitions"
import {
  EVENT_LABELS,
  formatMoney,
  getOrder,
  isEditable,
  OrderError,
  orderOptions,
  today,
} from "@templates/orders"
import { Card } from "@templates/ui/card"
import { cn } from "@templates/ui/cn"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { formatDay } from "@/components/invoice-document"
import { OrderBadge } from "@/components/order-badge"
import { OrderActions, OrderEditor, OrderNoteBox } from "@/components/orders"
import { timeAgo } from "@/components/time-ago"

export const metadata: Metadata = { title: "Order" }

const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })

export default async function OrderPage({ params }: PageProps<"/orders/[id]">) {
  const { id } = await params
  const ctx = await requirePermission({ order: ["read"] }).catch(() => redirect("/dashboard"))
  const data = await getOrder(ctx, id).catch((e) => {
    if (e instanceof OrderError) notFound()
    throw e
  })
  const { order: o, customer, lines, events, invoice, location } = data
  const [canWrite, canConfirm, canFulfill, canCancel, canInvoice, options] = await Promise.all([
    can({ order: ["write"] }),
    can({ order: ["confirm"] }),
    can({ order: ["fulfill"], inventory: ["move"] }),
    can({ order: ["cancel"] }),
    can({ invoice: ["write"] }),
    orderOptions(ctx),
  ])
  const t = today()
  const due = o.status === "confirmed" && !!o.requestedOn && o.requestedOn <= t
  const editable = isEditable(o.status) && canWrite

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <Link href="/orders" className="text-sm text-muted-foreground hover:text-foreground">
            ← Orders
          </Link>
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">
            Order {o.number}
            <OrderBadge status={o.status} due={due} />
          </h1>
          <p className="text-sm text-muted-foreground">
            {customer && (
              <Link href={`/customers/${customer.id}`} className="hover:underline">
                {customer.name}
              </Link>
            )}
            {" · "}ordered {formatDay(o.orderDate)}
            {o.requestedOn && (
              <span className={cn(due && "text-danger")}>
                {" "}
                · wanted by {formatDay(o.requestedOn)}
              </span>
            )}
          </p>
        </div>
        <OrderActions
          id={o.id}
          number={o.number}
          status={o.status}
          hasStockLines={lines.some((l) => l.productId)}
          locationId={o.locationId}
          locations={options.locations}
          hasInvoice={!!o.invoiceId}
          can={{
            write: canWrite,
            confirm: canConfirm,
            fulfill: canFulfill,
            cancel: canCancel,
            invoice: canInvoice,
          }}
        />
      </div>

      {o.status === "cancelled" && o.cancelReason && (
        <p className="rounded-lg border border-danger/40 px-4 py-3 text-sm">
          <span className="font-medium">Cancelled:</span> {o.cancelReason}
        </p>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className={cn(editable ? "" : "p-0")}>
          {editable ? (
            <OrderEditor
              key={o.updatedAt.toISOString()}
              id={o.id}
              customers={options.customers}
              products={options.products}
              locations={options.locations}
              available={lines.map((l) =>
                l.productId && l.available !== null
                  ? formatQuantity(l.available, l.unit ?? "")
                  : null,
              )}
              initial={{
                customerId: o.customerId,
                orderDate: o.orderDate,
                requestedOn: o.requestedOn ?? "",
                locationId: o.locationId ?? "",
                currency: o.currency,
                shippingAddress: o.shippingAddress ?? "",
                notes: o.notes ?? "",
                lines: lines.map((l) => ({
                  productId: l.productId ?? "",
                  description: l.description,
                  quantity: String(l.quantityMilli / 1000),
                  unitPrice: (l.unitPriceCents / 100).toFixed(2),
                  taxRate: String(l.taxRateBp / 100),
                })),
              }}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Item</th>
                    <th className="px-4 py-2.5 text-right font-medium">Qty</th>
                    <th className="px-4 py-2.5 text-right font-medium">Price</th>
                    <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td className="px-4 py-3">
                        {l.productId ? (
                          <Link href={`/inventory/${l.productId}`} className="hover:underline">
                            {l.description}
                          </Link>
                        ) : (
                          l.description
                        )}
                        {l.sku && (
                          <span className="block font-mono text-xs text-muted-foreground">
                            {l.sku}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        {formatQuantity(l.quantityMilli, l.unit ?? undefined)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        {formatMoney(l.unitPriceCents, o.currency)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        {formatMoney(l.amountCents, o.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <dl className="ml-auto grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 px-4 py-4 text-sm tabular-nums">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="text-right">{formatMoney(o.subtotalCents, o.currency)}</dd>
                <dt className="text-muted-foreground">Tax</dt>
                <dd className="text-right">{formatMoney(o.taxCents, o.currency)}</dd>
                <dt className="border-t pt-1 font-semibold">Total</dt>
                <dd className="border-t pt-1 text-right font-semibold">
                  {formatMoney(o.totalCents, o.currency)}
                </dd>
              </dl>
            </div>
          )}
        </Card>

        <div className="grid gap-4">
          <Card className="grid gap-2 p-5 text-sm">
            <h2 className="font-semibold">Delivery</h2>
            <p className="text-muted-foreground">
              Ships from {location?.name ?? "a location chosen when shipping"}
            </p>
            {o.shippingAddress && <p className="whitespace-pre-line">{o.shippingAddress}</p>}
            {o.fulfilledAt && (
              <p className="text-success">Fulfilled {when.format(o.fulfilledAt)}</p>
            )}
          </Card>

          {invoice && (
            <Card className="grid gap-1 p-5 text-sm">
              <h2 className="font-semibold">Invoice</h2>
              <Link href={`/invoices/${invoice.id}`} className="font-mono hover:underline">
                {invoice.number ?? "Draft invoice"}
              </Link>
              <p className="text-muted-foreground">
                {STATE_LABELS[invoiceState(invoice, t)]} ·{" "}
                {formatMoney(invoice.amountPaidCents, o.currency)} of{" "}
                {formatMoney(invoice.totalCents, o.currency)} paid
              </p>
            </Card>
          )}

          <Card className="grid gap-4 p-5">
            <h2 className="text-sm font-semibold">History</h2>
            <OrderNoteBox id={o.id} />
            <ol className="grid gap-3">
              {events.map((e) => (
                <li key={e.id} className="text-sm">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{EVENT_LABELS[e.kind]}</span> ·{" "}
                    <time dateTime={e.createdAt.toISOString()} title={when.format(e.createdAt)}>
                      {timeAgo(e.createdAt)}
                    </time>
                    {e.kind === "note" && e.byName && ` · ${e.byName}`}
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap break-words">{e.body}</p>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  )
}
