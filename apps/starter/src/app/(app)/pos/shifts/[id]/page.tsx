import { requirePermission } from "@templates/auth/guards"
import {
  CASH_MOVEMENT_LABELS,
  formatMoney,
  PosError,
  shiftReport,
  TENDER_LABELS,
} from "@templates/pos"
import { Card } from "@templates/ui/card"
import { cn } from "@templates/ui/cn"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { PrintButton } from "@/components/print-button"

export const metadata: Metadata = { title: "Shift report" }

const stamp = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })

export default async function ShiftPage({ params }: PageProps<"/pos/shifts/[id]">) {
  const { orgId } = await requirePermission({ pos: ["read"] }).catch(() => redirect("/dashboard"))
  const r = await shiftReport({ orgId }, (await params).id).catch((e) => {
    if (e instanceof PosError && e.status === 404) notFound()
    throw e
  })
  const { shift: s, drawer, totals } = r
  const money = (c: number) => formatMoney(c, r.currency)
  const variance = s.varianceCents ?? 0
  const row = (label: string, cents: number, opts: { sign?: "+" | "−"; strong?: boolean } = {}) => (
    <div className={cn("flex justify-between gap-3 py-1.5", opts.strong && "font-semibold")}>
      <dt>{label}</dt>
      <dd className="tabular-nums">
        {opts.sign && cents > 0 ? `${opts.sign} ` : ""}
        {money(cents)}
      </dd>
    </div>
  )

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/pos/shifts" className="text-sm text-muted-foreground hover:underline">
          ← Shifts
        </Link>
        <PrintButton />
      </div>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {r.register?.name ?? "Register"} · {s.status === "open" ? "open shift" : "shift report"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {r.register?.locationName} · opened {stamp.format(s.openedAt)}
          {r.openedByName ? ` by ${r.openedByName}` : ""}
          {s.closedAt &&
            ` · closed ${stamp.format(s.closedAt)}${r.closedByName ? ` by ${r.closedByName}` : ""}`}
        </p>
      </div>

      {s.status === "closed" && (
        <div
          role="status"
          className={cn(
            "rounded-xl border px-5 py-4",
            variance < 0 && "border-danger/50",
            variance > 0 && "border-warning/50",
          )}
        >
          <p className="text-sm text-muted-foreground">Drawer count</p>
          <p className={cn("text-2xl font-semibold tabular-nums", variance < 0 && "text-danger")}>
            {variance === 0
              ? "Matched"
              : `${money(Math.abs(variance))} ${variance < 0 ? "short" : "over"}`}
          </p>
          <p className="text-sm text-muted-foreground">
            Counted {money(s.countedCashCents ?? 0)}, expected {money(s.expectedCashCents ?? 0)}
            {s.closingNote ? ` · “${s.closingNote}”` : ""}
          </p>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-2 font-semibold">Takings</h2>
          <dl className="divide-y text-sm">
            <div className="flex justify-between gap-3 py-1.5">
              <dt>Sales</dt>
              <dd className="tabular-nums">{totals.sales}</dd>
            </div>
            {row("Before discounts", totals.subtotalCents)}
            {row("Discounts", totals.discountCents, { sign: "−" })}
            {row(r.pricesIncludeTax ? "Tax (included)" : "Tax", totals.taxCents)}
            {row("Total sold", totals.totalCents, { strong: true })}
            {row("Refunds", totals.refundsCents, { sign: "−" })}
            {row("Net", totals.totalCents - totals.refundsCents, { strong: true })}
          </dl>
          <h3 className="mt-4 mb-1 text-xs font-medium text-muted-foreground">By tender</h3>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 font-medium">Tender</th>
                <th className="py-1 text-right font-medium">Taken</th>
                <th className="py-1 text-right font-medium">Refunded</th>
              </tr>
            </thead>
            <tbody>
              {r.tenders.map((t) => (
                <tr key={t.tender}>
                  <td className="py-1">{TENDER_LABELS[t.tender]}</td>
                  <td className="py-1 text-right tabular-nums">{money(t.salesCents)}</td>
                  <td className="py-1 text-right tabular-nums">{money(t.refundsCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card className="p-5">
          <h2 className="mb-2 font-semibold">Cash drawer</h2>
          <dl className="divide-y text-sm">
            {row("Opening float", drawer.openingFloatCents)}
            {row("Cash sales", drawer.cashSalesCents, { sign: "+" })}
            {row("Cash in", drawer.paidInCents, { sign: "+" })}
            {row("Cash out", drawer.paidOutCents, { sign: "−" })}
            {row("Cash refunds", drawer.cashRefundsCents, { sign: "−" })}
            {row("Should be in the drawer", drawer.expectedCents, { strong: true })}
          </dl>
          {r.movements.length > 0 && (
            <>
              <h3 className="mt-4 mb-1 text-xs font-medium text-muted-foreground">
                Cash in and out
              </h3>
              <ul className="grid gap-1 text-sm">
                {r.movements.map((m) => (
                  <li key={m.id} className="flex justify-between gap-3">
                    <span className="min-w-0">
                      {CASH_MOVEMENT_LABELS[m.kind]}: {m.reason}
                      <span className="text-muted-foreground">
                        {m.byName ? ` · ${m.byName}` : ""}
                      </span>
                    </span>
                    <span className="tabular-nums">
                      {m.kind === "paid_out" ? "−" : "+"}
                      {money(m.amountCents)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>
      <p className="text-sm print:hidden">
        <Link
          href={`/pos/sales?register=${s.registerId}`}
          className="text-muted-foreground hover:underline"
        >
          Sales on this register
        </Link>
      </p>
    </div>
  )
}
