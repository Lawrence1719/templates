import { can, requirePermission } from "@templates/auth/guards"
import {
  formatMoney,
  INVOICE_FILTER_STATES,
  invoiceCustomers,
  invoiceFilterSchema,
  invoiceState,
  invoiceSummary,
  listInvoices,
  QUOTE_FILTER_STATES,
  STATE_LABELS,
  today,
} from "@templates/invoicing"
import { Card, PageHeader } from "@templates/ui/card"
import { cn } from "@templates/ui/cn"
import { Plus, Settings } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { formatDay, StateBadge } from "@/components/invoice-document"

export const metadata: Metadata = { title: "Invoices" }

const sum = (rows: { currency: string; cents: number }[]) =>
  rows.length ? rows.map((r) => formatMoney(r.cents, r.currency)).join(" + ") : "—"

export default async function InvoicesPage({ searchParams }: PageProps<"/invoices">) {
  const { orgId } = await requirePermission({ invoice: ["read"] }).catch(() =>
    redirect("/dashboard"),
  )
  const raw = Object.fromEntries(
    Object.entries(await searchParams).map(([k, v]) => [
      k,
      Array.isArray(v) ? v[0] : v || undefined,
    ]),
  )
  const t = today()
  const [{ rows, total, page, pageSize, filter }, summary, customers, canWrite, canSettings] =
    await Promise.all([
      listInvoices({ orgId }, raw, t),
      invoiceSummary({ orgId }, t),
      invoiceCustomers({ orgId }),
      can({ invoice: ["write"] }),
      can({ invoice: ["settings"] }),
    ])
  const kind = invoiceFilterSchema.parse(raw).kind
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const states = kind === "quote" ? QUOTE_FILTER_STATES : INVOICE_FILTER_STATES
  const customerName = filter.customer
    ? customers.find((c) => c.id === filter.customer)?.name
    : undefined

  const qs = (patch: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...filter, ...patch }))
      if (
        v !== undefined &&
        v !== "" &&
        !(k === "page" && v === 1) &&
        !(k === "kind" && v === "invoice")
      )
        p.set(k, String(v))
    const s = p.toString()
    return `/invoices${s ? `?${s}` : ""}`
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader
        title={kind === "quote" ? "Quotes" : "Invoices"}
        description="Quote, bill and get paid. Sent documents are locked; void and copy to make changes."
        actions={
          <div className="flex gap-2">
            {canSettings && (
              <Link
                href="/invoices/settings"
                aria-label="Invoice settings"
                className="inline-flex size-9 items-center justify-center rounded-md border hover:bg-accent [&_svg]:size-4"
              >
                <Settings />
              </Link>
            )}
            {canWrite && (
              <Link
                href={`/invoices/new?kind=${kind}${filter.customer ? `&customer=${filter.customer}` : ""}`}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 [&_svg]:size-4"
              >
                <Plus /> New {kind}
              </Link>
            )}
          </div>
        }
      />

      {kind === "invoice" && (
        <dl className="grid gap-3 sm:grid-cols-3">
          {[
            {
              label: "Outstanding",
              value: sum(summary.outstanding),
              href: qs({ state: "open", page: undefined }),
            },
            {
              label: `Overdue${summary.overdue.length ? ` · ${summary.overdue.reduce((n, r) => n + r.n, 0)}` : ""}`,
              value: sum(summary.overdue),
              href: qs({ state: "overdue", page: undefined }),
              danger: summary.overdue.length > 0,
            },
            {
              label: "Collected, last 30 days",
              value: sum(summary.collected),
              href: qs({ state: "paid", page: undefined }),
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
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="flex rounded-md border p-0.5 text-sm"
          role="group"
          aria-label="Document type"
        >
          {(["invoice", "quote"] as const).map((k) => (
            <Link
              key={k}
              href={k === "invoice" ? "/invoices" : "/invoices?kind=quote"}
              aria-current={kind === k ? "page" : undefined}
              className={cn(
                "rounded px-3 py-1.5",
                kind === k
                  ? "bg-accent font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {k === "invoice" ? "Invoices" : "Quotes"}
            </Link>
          ))}
        </div>
        <form
          action="/invoices"
          className="flex min-w-0 flex-1 flex-wrap justify-end gap-2 sm:flex-none"
        >
          {kind === "quote" && <input type="hidden" name="kind" value="quote" />}
          {filter.customer && <input type="hidden" name="customer" value={filter.customer} />}
          {filter.state && <input type="hidden" name="state" value={filter.state} />}
          <input
            type="search"
            name="q"
            defaultValue={filter.q ?? ""}
            aria-label="Search by number or customer"
            placeholder="Number or customer…"
            className="h-9 min-w-0 flex-1 rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-56 sm:flex-none"
          />
        </form>
      </div>

      <nav aria-label="Filter by status" className="-mt-2 flex flex-wrap gap-1.5 text-sm">
        {[undefined, ...states].map((s) => (
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
            {s ? STATE_LABELS[s as keyof typeof STATE_LABELS] : "All"}
          </Link>
        ))}
        {customerName && (
          <Link
            href={qs({ customer: undefined, page: undefined })}
            className="rounded-full border px-3 py-1"
          >
            {customerName} ✕
          </Link>
        )}
      </nav>

      <Card className="overflow-hidden p-0">
        {rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            {filter.state || filter.q || filter.customer
              ? `No ${kind}s match.`
              : `No ${kind}s yet.`}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Number</th>
                  <th className="px-4 py-2.5 font-medium">Customer</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Issued</th>
                  <th className="hidden px-4 py-2.5 font-medium sm:table-cell">
                    {kind === "quote" ? "Valid until" : "Due"}
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    {kind === "quote" ? "Total" : "Balance"}
                  </th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => {
                  const state = invoiceState(r, t)
                  const shown =
                    kind === "invoice" && r.status !== "draft"
                      ? r.totalCents - r.amountPaidCents
                      : r.totalCents
                  return (
                    <tr key={r.id} className="hover:bg-muted/50">
                      <td className="px-4 py-3">
                        <Link
                          href={`/invoices/${r.id}`}
                          className="font-mono font-medium hover:underline"
                        >
                          {r.number ?? "Draft"}
                        </Link>
                      </td>
                      <td className="px-4 py-3">{r.customerName}</td>
                      <td className="hidden whitespace-nowrap px-4 py-3 text-muted-foreground md:table-cell">
                        {formatDay(r.issueDate)}
                      </td>
                      <td
                        className={cn(
                          "hidden whitespace-nowrap px-4 py-3 text-muted-foreground sm:table-cell",
                          state === "overdue" && "text-danger",
                        )}
                      >
                        {r.dueOn ? formatDay(r.dueOn) : "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        {formatMoney(shown, r.currency)}
                      </td>
                      <td className="px-4 py-3">
                        <StateBadge state={state} />
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
            {total} {kind}s · page {page} of {pages}
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
