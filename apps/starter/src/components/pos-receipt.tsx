import {
  formatMoney,
  formatPercent,
  formatQuantity,
  type getSale,
  TENDER_LABELS,
} from "@templates/pos"

type Sale = Awaited<ReturnType<typeof getSale>>

const stamp = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone }).format(d)

/** A till receipt. Narrow enough for an 80 mm printer, readable on screen. */
export function Receipt({ data }: { data: Sale }) {
  const { sale: s, lines, payments, refunds, settings } = data
  const money = (c: number) => formatMoney(c, s.currency)
  const change = payments.reduce((n, p) => n + p.changeCents, 0)
  return (
    <article className="mx-auto grid w-full max-w-xs gap-3 font-mono text-[13px] leading-snug">
      <header className="text-center">
        <p className="text-base font-semibold">{data.orgName}</p>
        {settings.receiptHeader && (
          <p className="whitespace-pre-line text-muted-foreground print:text-black">
            {settings.receiptHeader}
          </p>
        )}
      </header>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 border-y border-dashed py-2">
        <span>Receipt</span>
        <span className="text-right">{s.number}</span>
        <span>Date</span>
        <span className="text-right">{stamp(s.createdAt, settings.timeZone)}</span>
        {data.register && (
          <>
            <span>Register</span>
            <span className="text-right">{data.register.name}</span>
          </>
        )}
        {data.cashierName && (
          <>
            <span>Cashier</span>
            <span className="text-right">{data.cashierName}</span>
          </>
        )}
        {data.customer && (
          <>
            <span>Customer</span>
            <span className="text-right">{data.customer.name}</span>
          </>
        )}
      </div>
      <ul className="grid gap-1.5">
        {lines.map((l) => (
          <li key={l.id}>
            <div className="flex justify-between gap-2">
              <span className="min-w-0 break-words">{l.description}</span>
              <span className="tabular-nums">{money(l.totalCents)}</span>
            </div>
            <div className="text-muted-foreground print:text-black">
              {formatQuantity(l.quantityMilli)} × {money(l.unitPriceCents)}
              {l.discountBp > 0 && ` · ${formatPercent(l.discountBp)} off`}
            </div>
          </li>
        ))}
      </ul>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 border-t border-dashed pt-2 tabular-nums">
        <dt>Subtotal</dt>
        <dd className="text-right">{money(s.subtotalCents)}</dd>
        {s.discountCents > 0 && (
          <>
            <dt>Discounts</dt>
            <dd className="text-right">−{money(s.discountCents)}</dd>
          </>
        )}
        {s.taxCents > 0 && (
          <>
            <dt>
              Tax {formatPercent(lines[0]?.taxRateBp ?? 0)}
              {settings.pricesIncludeTax ? " incl." : ""}
            </dt>
            <dd className="text-right">{money(s.taxCents)}</dd>
          </>
        )}
        <dt className="text-base font-semibold">Total</dt>
        <dd className="text-right text-base font-semibold">{money(s.totalCents)}</dd>
      </dl>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 border-t border-dashed pt-2 tabular-nums">
        {payments.map((p) => (
          <div key={p.id} className="contents">
            <dt>
              {TENDER_LABELS[p.tender]}
              {p.reference ? ` ${p.reference}` : ""}
            </dt>
            <dd className="text-right">{money(p.tenderedCents)}</dd>
          </div>
        ))}
        {change > 0 && (
          <>
            <dt>Change</dt>
            <dd className="text-right">{money(change)}</dd>
          </>
        )}
        {refunds.map((r) => (
          <div key={r.id} className="contents">
            <dt>Refunded ({TENDER_LABELS[r.tender]})</dt>
            <dd className="text-right">−{money(r.amountCents)}</dd>
          </div>
        ))}
      </dl>
      {settings.receiptFooter && (
        <p className="border-t border-dashed pt-2 text-center whitespace-pre-line">
          {settings.receiptFooter}
        </p>
      )}
    </article>
  )
}
