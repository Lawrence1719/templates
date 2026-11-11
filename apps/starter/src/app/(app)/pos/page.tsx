import { can, requirePermission } from "@templates/auth/guards"
import {
  formatMoney,
  formatQuantity,
  listRegisters,
  listSales,
  salesSummary,
  TENDER_LABELS,
} from "@templates/pos"
import { Card, PageHeader } from "@templates/ui/card"
import { Settings2, Store } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

export const metadata: Metadata = { title: "Point of sale" }

const timeFmt = (tz: string) =>
  new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", timeZone: tz })

export default async function PosPage() {
  const { orgId } = await requirePermission({ pos: ["read"] }).catch(() => redirect("/dashboard"))
  const [registers, today, recent, canSell, canManage] = await Promise.all([
    listRegisters({ orgId }),
    salesSummary({ orgId }),
    listSales({ orgId }),
    can({ pos: ["sell"] }),
    can({ pos: ["manage"] }),
  ])
  const money = (c: number) => formatMoney(c, today.currency)
  const time = timeFmt(today.timeZone)
  const tenderTotal = today.tenders.reduce((n, t) => n + t.cents, 0)

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader
        title="Point of sale"
        description="Ring up sales at the counter, take cash or card, and balance the drawer."
        actions={
          <div className="flex gap-2">
            <Link
              href="/pos/shifts"
              className="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium hover:bg-accent"
            >
              Shifts
            </Link>
            {canManage && (
              <Link
                href="/pos/setup"
                className="inline-flex h-9 items-center gap-2 rounded-md border px-4 text-sm font-medium hover:bg-accent [&_svg]:size-4"
              >
                <Settings2 /> Setup
              </Link>
            )}
          </div>
        }
      />

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Net sales today", value: money(today.netCents) },
          { label: "Sales", value: String(today.sales) },
          { label: "Average sale", value: money(today.averageCents) },
          { label: "Refunds", value: money(today.refundsCents) },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border px-4 py-3">
            <dt className="text-xs text-muted-foreground">{s.label}</dt>
            <dd className="mt-1 truncate text-xl font-semibold tabular-nums">{s.value}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="registers" className="grid gap-3">
        <h2 id="registers" className="font-semibold">
          Registers
        </h2>
        {registers.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            No registers yet.{" "}
            {canManage ? (
              <Link href="/pos/setup" className="underline">
                Add one in setup
              </Link>
            ) : (
              "Ask an admin to add one."
            )}
          </Card>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {registers.map((r) => (
              <li key={r.id} className="grid gap-3 rounded-xl border p-4">
                <div className="flex items-start gap-3">
                  <span className="grid size-9 place-items-center rounded-lg bg-muted [&_svg]:size-4">
                    <Store />
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium">{r.name}</p>
                    <p className="text-sm text-muted-foreground">{r.locationName}</p>
                  </div>
                </div>
                <p className="text-sm">
                  {r.shiftId && r.shiftOpenedAt ? (
                    <span className="text-success">
                      Open since {time.format(r.shiftOpenedAt)}
                      {r.shiftOpenedBy ? ` · ${r.shiftOpenedBy}` : ""}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Closed</span>
                  )}
                </p>
                {canSell && (
                  <Link
                    href={`/pos/till/${r.id}`}
                    className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
                  >
                    {r.shiftId ? "Go to till" : "Open till"}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section aria-labelledby="recent" className="grid content-start gap-3">
          <div className="flex items-center justify-between">
            <h2 id="recent" className="font-semibold">
              Recent sales
            </h2>
            <Link href="/pos/sales" className="text-sm text-muted-foreground hover:underline">
              All sales
            </Link>
          </div>
          <Card className="overflow-hidden p-0">
            {recent.rows.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">No sales yet.</p>
            ) : (
              <ul className="divide-y text-sm">
                {recent.rows.slice(0, 8).map((s) => (
                  <li key={s.id}>
                    <Link
                      href={`/pos/sales/${s.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-muted/50"
                    >
                      <span className="min-w-0">
                        <span className="font-mono font-medium">{s.number}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          · {time.format(s.createdAt)} · {s.registerName}
                        </span>
                      </span>
                      <span className="tabular-nums">
                        {formatMoney(s.totalCents, s.currency)}
                        {s.refundedCents > 0 && (
                          <span className="ml-1 text-xs text-danger">refunded</span>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>

        <section aria-labelledby="today" className="grid content-start gap-3">
          <h2 id="today" className="font-semibold">
            Today
          </h2>
          <Card className="grid gap-4 p-4 text-sm">
            <div className="grid gap-2">
              <p className="text-xs font-medium text-muted-foreground">Taken by</p>
              {today.tenders.map((t) => (
                <div key={t.tender} className="grid gap-1">
                  <div className="flex justify-between">
                    <span>{TENDER_LABELS[t.tender]}</span>
                    <span className="tabular-nums">{money(t.cents)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${tenderTotal ? (t.cents / tenderTotal) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="grid gap-1.5">
              <p className="text-xs font-medium text-muted-foreground">Best sellers</p>
              {today.top.length === 0 ? (
                <p className="text-muted-foreground">Nothing sold yet today.</p>
              ) : (
                <ol className="grid gap-1">
                  {today.top.map((t) => (
                    <li
                      key={`${t.productId}-${t.description}`}
                      className="flex justify-between gap-2"
                    >
                      <span className="truncate">
                        {t.description}
                        <span className="text-muted-foreground">
                          {" "}
                          × {formatQuantity(t.quantityMilli)}
                        </span>
                      </span>
                      <span className="tabular-nums">{money(t.cents)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </Card>
        </section>
      </div>
    </div>
  )
}
