import { can, requirePermission } from "@templates/auth/guards"
import {
  formatMoney,
  formatQuantity,
  getSale,
  PosError,
  registerOptions,
  SALE_STATE_LABELS,
  saleState,
  TENDER_LABELS,
} from "@templates/pos"
import { Card } from "@templates/ui/card"
import { Printer } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { RefundForm } from "@/components/pos"
import { Receipt } from "@/components/pos-receipt"

export const metadata: Metadata = { title: "Sale" }

const stamp = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })

export default async function SalePage({ params }: PageProps<"/pos/sales/[id]">) {
  const { orgId } = await requirePermission({ pos: ["read"] }).catch(() => redirect("/dashboard"))
  const { id } = await params
  const data = await getSale({ orgId }, id).catch((e) => {
    if (e instanceof PosError && e.status === 404) notFound()
    throw e
  })
  const [canRefund, registers] = await Promise.all([
    can({ pos: ["refund"] }),
    registerOptions({ orgId }),
  ])
  const { sale: s, lines, refunds, payments } = data
  const state = saleState({ ...s, refundedAll: data.refundedAll })
  const money = (c: number) => formatMoney(c, s.currency)
  const lineName = new Map(lines.map((l) => [l.id, l.description]))

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/pos/sales" className="text-sm text-muted-foreground hover:underline">
            ← Sales
          </Link>
          <h1 className="mt-1 font-mono text-2xl font-semibold tracking-tight">{s.number}</h1>
          <p className="text-sm text-muted-foreground">
            {SALE_STATE_LABELS[state]}
            {s.refundedCents > 0 && ` · ${money(s.refundedCents)} given back`}
          </p>
        </div>
        <a
          href={`/receipt/${s.id}?print=1`}
          target="_blank"
          rel="noopener"
          className="inline-flex h-9 items-center gap-2 rounded-md border px-4 text-sm font-medium hover:bg-accent [&_svg]:size-4"
        >
          <Printer /> Print receipt
        </a>
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card className="p-5">
          <Receipt data={data} />
        </Card>
        <div className="grid content-start gap-6">
          {canRefund && registers.length > 0 && (
            <RefundForm
              saleId={s.id}
              currency={s.currency}
              registers={registers}
              defaultTender={payments[0]?.tender ?? "cash"}
              defaultRegisterId={s.registerId}
              lines={lines.map((l) => ({
                id: l.id,
                description: l.description,
                unit: l.unit,
                productId: l.productId,
                quantityMilli: l.quantityMilli,
                totalCents: l.totalCents,
                refundedQtyMilli: l.refundedQtyMilli,
                refundedCents: l.refundedCents,
              }))}
            />
          )}
          <section aria-labelledby="refunds" className="grid gap-2">
            <h2 id="refunds" className="font-semibold">
              Refunds
            </h2>
            {refunds.length === 0 ? (
              <p className="text-sm text-muted-foreground">None.</p>
            ) : (
              <ul className="grid gap-3">
                {refunds.map((r) => (
                  <li key={r.id} className="rounded-xl border p-4 text-sm">
                    <p className="flex justify-between gap-2">
                      <span className="font-medium">
                        {money(r.amountCents)} · {TENDER_LABELS[r.tender]}
                      </span>
                      <span className="text-muted-foreground">{stamp.format(r.createdAt)}</span>
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      {r.reason}
                      {r.byName ? ` · ${r.byName}` : ""}
                      {r.restocked ? " · back in stock" : ""}
                    </p>
                    <ul className="mt-2 text-xs text-muted-foreground">
                      {r.lines.map((l) => (
                        <li key={l.saleLineId}>
                          {formatQuantity(l.quantityMilli)} × {lineName.get(l.saleLineId)} (
                          {money(l.amountCents)})
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {s.note && (
            <section className="grid gap-1 text-sm">
              <h2 className="font-semibold">Note</h2>
              <p className="whitespace-pre-line text-muted-foreground">{s.note}</p>
            </section>
          )}
          <p className="text-sm">
            <Link
              href={`/pos/shifts/${s.shiftId}`}
              className="text-muted-foreground hover:underline"
            >
              View the shift this sale was in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
