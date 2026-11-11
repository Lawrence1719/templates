import {
  formatMoney,
  formatPercent,
  formatQuantity,
  type InvoiceState,
  STATE_LABELS,
} from "@templates/invoicing/definitions"
import { cn } from "@templates/ui/cn"

const dayFmt = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" })
export const formatDay = (d: string) => dayFmt.format(new Date(`${d}T00:00:00Z`))

export function StateBadge({ state }: { state: InvoiceState }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs whitespace-nowrap",
        (state === "paid" || state === "accepted") && "border-success/40 text-success",
        state === "overdue" && "border-danger/50 text-danger",
        (state === "void" || state === "declined" || state === "expired") &&
          "text-muted-foreground",
        state === "void" && "line-through",
        state === "draft" && "border-dashed text-muted-foreground",
      )}
    >
      {STATE_LABELS[state]}
    </span>
  )
}

type Doc = {
  kind: "quote" | "invoice"
  number: string | null
  issueDate: string
  dueOn: string | null
  currency: string
  subtotalCents: number
  taxCents: number
  totalCents: number
  amountPaidCents: number
  notes: string | null
  terms: string | null
}
type Line = {
  id: string
  description: string
  quantityMilli: number
  unitPriceCents: number
  taxRateBp: number
  amountCents: number
}

/** The quote or invoice as the customer sees it. Used in the app and on the shared link. */
export function InvoiceDocument({
  doc,
  lines,
  from,
  to,
  instructions,
  footer,
}: {
  doc: Doc
  lines: Line[]
  from: { name: string; details?: string | null }
  to: { name: string; email?: string | null; address?: string | null } | null
  instructions?: string | null
  footer?: string | null
}) {
  const money = (c: number) => formatMoney(c, doc.currency)
  const hasTax = lines.some((l) => l.taxRateBp > 0)
  const balance = doc.totalCents - doc.amountPaidCents
  const title = doc.kind === "quote" ? "Quote" : "Invoice"
  return (
    <article className="grid gap-8 text-sm">
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="text-lg font-semibold">{from.name}</p>
          {from.details && (
            <p className="mt-1 whitespace-pre-line text-muted-foreground">{from.details}</p>
          )}
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold tracking-tight">{title}</p>
          <p className="font-mono text-muted-foreground">{doc.number ?? "Draft"}</p>
        </div>
      </header>

      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {doc.kind === "quote" ? "Prepared for" : "Bill to"}
          </p>
          <p className="mt-1 font-medium">{to?.name ?? "—"}</p>
          {to?.address && <p className="whitespace-pre-line text-muted-foreground">{to.address}</p>}
          {to?.email && <p className="text-muted-foreground">{to.email}</p>}
        </div>
        <dl className="grid grid-cols-[auto_auto] justify-start gap-x-6 gap-y-1 sm:justify-end">
          <dt className="text-muted-foreground">Issued</dt>
          <dd>{formatDay(doc.issueDate)}</dd>
          {doc.dueOn && (
            <>
              <dt className="text-muted-foreground">
                {doc.kind === "quote" ? "Valid until" : "Due"}
              </dt>
              <dd>{formatDay(doc.dueOn)}</dd>
            </>
          )}
        </dl>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem]">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-2 pr-3 font-medium">Description</th>
              <th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="px-3 py-2 text-right font-medium">Price</th>
              {hasTax && <th className="px-3 py-2 text-right font-medium">Tax</th>}
              <th className="py-2 pl-3 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {lines.map((l) => (
              <tr key={l.id} className="align-top">
                <td className="py-2.5 pr-3 whitespace-pre-line">{l.description}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {formatQuantity(l.quantityMilli)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{money(l.unitPriceCents)}</td>
                {hasTax && (
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                    {l.taxRateBp ? formatPercent(l.taxRateBp) : "—"}
                  </td>
                )}
                <td className="py-2.5 pl-3 text-right tabular-nums">{money(l.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="ml-auto grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 tabular-nums">
        <dt className="text-muted-foreground">Subtotal</dt>
        <dd className="text-right">{money(doc.subtotalCents)}</dd>
        {doc.taxCents !== 0 && (
          <>
            <dt className="text-muted-foreground">Tax</dt>
            <dd className="text-right">{money(doc.taxCents)}</dd>
          </>
        )}
        <dt className="border-t pt-1.5 font-semibold">Total</dt>
        <dd className="border-t pt-1.5 text-right font-semibold">{money(doc.totalCents)}</dd>
        {doc.kind === "invoice" && doc.amountPaidCents > 0 && (
          <>
            <dt className="text-muted-foreground">Paid</dt>
            <dd className="text-right">−{money(doc.amountPaidCents)}</dd>
            <dt className="font-semibold">Balance due</dt>
            <dd className="text-right font-semibold">{money(balance)}</dd>
          </>
        )}
      </dl>

      {(doc.notes || doc.terms || instructions) && (
        <div className="grid gap-4 border-t pt-6 sm:grid-cols-2">
          {doc.notes && (
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Notes</p>
              <p className="mt-1 whitespace-pre-line">{doc.notes}</p>
            </div>
          )}
          {doc.kind === "invoice" && instructions && (
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">How to pay</p>
              <p className="mt-1 whitespace-pre-line">{instructions}</p>
            </div>
          )}
          {doc.terms && (
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Terms</p>
              <p className="mt-1 whitespace-pre-line">{doc.terms}</p>
            </div>
          )}
        </div>
      )}
      {footer && <p className="text-center text-xs text-muted-foreground">{footer}</p>}
    </article>
  )
}
