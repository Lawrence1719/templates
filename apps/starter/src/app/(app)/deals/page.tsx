import { can, requirePermission } from "@templates/auth/guards"
import { DEAL_STAGES, formatMoney, listDeals, OPEN_STAGES, STAGE_LABELS } from "@templates/crm"
import { PageHeader } from "@templates/ui/card"
import { cn } from "@templates/ui/cn"
import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { StageSelect } from "@/components/crm"
import { formatDay } from "@/components/crm-badges"

export const metadata: Metadata = { title: "Deals" }

/** Won and lost columns only show recent deals so the board stays about current work. */
const CLOSED_WINDOW_DAYS = 90

/** "$1,200.00 + €300.00": amounts in different currencies are listed, never added together. */
function totals(deals: { valueCents: number; currency: string }[]) {
  const by = new Map<string, number>()
  for (const d of deals) by.set(d.currency, (by.get(d.currency) ?? 0) + d.valueCents)
  return [...by].map(([cur, cents]) => formatMoney(cents, cur)).join(" + ") || "—"
}

export default async function DealsPage({ searchParams }: PageProps<"/deals">) {
  const { orgId, user } = await requirePermission({ deal: ["read"] }).catch(() =>
    redirect("/dashboard"),
  )
  const mine = (await searchParams).owner === "me"
  const [all, canWrite] = await Promise.all([
    listDeals({ orgId, userId: user.id }, mine ? { owner: "me" } : {}),
    can({ deal: ["write"] }),
  ])
  const cutoff = Date.now() - CLOSED_WINDOW_DAYS * 86_400_000
  const deals = all.filter((d) => !d.closedAt || d.closedAt.getTime() >= cutoff)
  const open = deals.filter((d) => (OPEN_STAGES as readonly string[]).includes(d.stage))
  const won = deals.filter((d) => d.stage === "won")
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader
        title="Deals"
        description="Your sales pipeline. Move a deal by changing its stage; open a customer to add one."
        actions={
          <div
            className="flex rounded-md border p-0.5 text-sm"
            role="group"
            aria-label="Whose deals"
          >
            {[
              { label: "All deals", href: "/deals", on: !mine },
              { label: "My deals", href: "/deals?owner=me", on: mine },
            ].map((t) => (
              <Link
                key={t.href}
                href={t.href}
                aria-current={t.on ? "page" : undefined}
                className={cn(
                  "rounded px-3 py-1.5",
                  t.on ? "bg-accent font-medium" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </Link>
            ))}
          </div>
        }
      />

      <dl className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Open deals", value: String(open.length) },
          { label: "Open pipeline", value: totals(open) },
          { label: `Won, last ${CLOSED_WINDOW_DAYS} days`, value: totals(won) },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border px-4 py-3">
            <dt className="text-xs text-muted-foreground">{s.label}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{s.value}</dd>
          </div>
        ))}
      </dl>

      {deals.length === 0 ? (
        <p className="rounded-xl border p-10 text-center text-sm text-muted-foreground">
          {mine ? "You don't own any deals." : "No deals yet."} Open a{" "}
          <Link href="/customers" className="underline">
            customer
          </Link>{" "}
          to add one.
        </p>
      ) : (
        // Columns scroll sideways on small screens rather than squeezing.
        <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
          <div className="grid min-w-[60rem] grid-cols-5 gap-3">
            {DEAL_STAGES.map((stage) => {
              const col = deals.filter((d) => d.stage === stage)
              return (
                <section
                  key={stage}
                  aria-label={STAGE_LABELS[stage]}
                  className="grid content-start gap-2"
                >
                  <header className="grid gap-0.5 px-1">
                    <h2 className="text-sm font-semibold">
                      {STAGE_LABELS[stage]}{" "}
                      <span className="font-normal text-muted-foreground">{col.length}</span>
                    </h2>
                    <span
                      className="truncate text-xs tabular-nums text-muted-foreground"
                      title={col.length ? totals(col) : undefined}
                    >
                      {col.length ? totals(col) : "\u00a0"}
                    </span>
                  </header>
                  <ul className="grid gap-2 rounded-xl bg-muted/60 p-2 min-h-24">
                    {col.map((d) => {
                      const overdue =
                        d.expectedCloseOn &&
                        d.expectedCloseOn < today &&
                        (OPEN_STAGES as readonly string[]).includes(d.stage)
                      return (
                        <li
                          key={d.id}
                          className="grid gap-2 rounded-lg border bg-background p-3 shadow-xs"
                        >
                          <div className="grid gap-0.5">
                            <Link
                              href={`/customers/${d.customerId}`}
                              className="text-sm font-medium leading-snug hover:underline"
                            >
                              {d.title}
                            </Link>
                            <span className="truncate text-xs text-muted-foreground">
                              {d.customerName}
                            </span>
                          </div>
                          <p className="text-sm tabular-nums">
                            {formatMoney(d.valueCents, d.currency)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {d.ownerName ?? "No owner"}
                            {d.expectedCloseOn && (
                              <span className={cn(overdue && "text-danger")}>
                                {" · "}
                                {overdue ? "was due" : "close"} {formatDay(d.expectedCloseOn)}
                              </span>
                            )}
                          </p>
                          {canWrite && <StageSelect id={d.id} stage={d.stage} title={d.title} />}
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
