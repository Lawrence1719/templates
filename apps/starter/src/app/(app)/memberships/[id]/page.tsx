import { can, requirePermission } from "@templates/auth/guards"
import { getMembership, MembershipError } from "@templates/memberships"
import {
  formatCardCode,
  formatMoney,
  formatPeriod,
  formatVisits,
  PAID_VIA_LABELS,
} from "@templates/memberships/definitions"
import { Card } from "@templates/ui/card"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import {
  CheckInHereButton,
  MembershipActions,
  StateBadge,
  VoidCheckInButton,
} from "@/components/memberships"

export const metadata: Metadata = { title: "Membership" }

const longDay = (d: string) =>
  new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${d}T00:00:00Z`),
  )

export default async function MembershipPage({ params }: PageProps<"/memberships/[id]">) {
  const { orgId } = await requirePermission({ membership: ["read"] }).catch(() =>
    redirect("/dashboard"),
  )
  const { id } = await params
  const data = await getMembership({ orgId }, id).catch((e) => {
    if (e instanceof MembershipError && e.status === 404) notFound()
    throw e
  })
  const [canSell, canDesk, canManage] = await Promise.all([
    can({ membership: ["sell"] }),
    can({ membership: ["checkin"] }),
    can({ membership: ["manage"] }),
  ])
  const { membership: m, plan, customer: c } = data
  const stamp = new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: data.timeZone,
  })

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/memberships" className="text-sm text-muted-foreground hover:underline">
            ← Memberships
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{c?.name}</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {plan?.name} <StateBadge state={data.state} />
          </p>
        </div>
        {canDesk && m.status === "active" && <CheckInHereButton id={m.id} />}
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card className="grid content-start gap-4 p-5">
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-muted-foreground">Current period</dt>
              <dd className="font-medium">
                {longDay(m.periodStart)} – {longDay(m.periodEnd)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Visits this period</dt>
              <dd className="font-medium tabular-nums">
                {data.visitsUsed}
                {plan?.visitLimit ? ` of ${plan.visitLimit} (${data.visitsLeft} left)` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Plan</dt>
              <dd>
                {plan &&
                  `${formatMoney(plan.priceCents, plan.currency)} ${formatPeriod(plan)} · ${formatVisits(plan.visitLimit)}`}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Member since</dt>
              <dd>{longDay(m.startedOn)}</dd>
            </div>
            {m.status === "paused" && m.pausedOn && (
              <div className="col-span-2 text-warning">
                Paused since {longDay(m.pausedOn)}. The days paused are added back on resume.
              </div>
            )}
            {m.status === "cancelled" && (
              <div className="col-span-2 text-muted-foreground">
                Cancelled {m.cancelledAt ? stamp.format(m.cancelledAt) : ""}: {m.cancelReason}
              </div>
            )}
          </dl>
          {canSell && plan && (
            <MembershipActions
              id={m.id}
              status={m.status}
              periodEnd={m.periodEnd}
              autoRenew={m.autoRenew}
              hasEmail={!!c?.email}
              canManage={canManage}
              price={formatMoney(plan.priceCents, plan.currency)}
            />
          )}
        </Card>

        <Card className="grid content-start gap-2 p-5">
          <h2 className="font-semibold">Card</h2>
          <p className="break-all font-mono text-lg tracking-wider">
            {formatCardCode(m.cardToken)}
          </p>
          <p className="text-sm text-muted-foreground">
            Scan or type this at the desk. The member's own card page is{" "}
            <a
              href={`/m/${m.cardToken}`}
              target="_blank"
              rel="noreferrer noopener"
              className="underline"
            >
              here
            </a>
            ; keep the link private.
          </p>
          {c && (
            <p className="text-sm">
              <Link href={`/customers/${c.id}`} className="underline">
                Customer record
              </Link>
              {c.email && <span className="text-muted-foreground"> · {c.email}</span>}
            </p>
          )}
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <section aria-labelledby="visits" className="grid content-start gap-3">
          <h2 id="visits" className="font-semibold">
            Recent visits
          </h2>
          <Card className="overflow-hidden p-0">
            {data.checkIns.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">No visits yet.</p>
            ) : (
              <ul className="divide-y text-sm">
                {data.checkIns.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-2 px-4 py-2">
                    <span className={v.voidedAt ? "text-muted-foreground line-through" : ""}>
                      {stamp.format(v.at)}
                      <span className="text-muted-foreground">
                        {" "}
                        · {v.method === "card" ? "card" : "desk"}
                        {v.byName ? ` · ${v.byName}` : ""}
                      </span>
                    </span>
                    {canManage && !v.voidedAt && <VoidCheckInButton id={v.id} />}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
        <section aria-labelledby="history" className="grid content-start gap-3">
          <h2 id="history" className="font-semibold">
            Payments and history
          </h2>
          <Card className="grid gap-4 p-4 text-sm">
            <ul className="grid gap-1.5">
              {data.periods.map((p) => (
                <li key={p.id} className="flex justify-between gap-2">
                  <span>
                    {longDay(p.startDay)} – {longDay(p.endDay)}
                  </span>
                  <span className="tabular-nums">
                    {p.paidVia === "free" ? "Free" : formatMoney(p.priceCents, p.currency)}{" "}
                    {p.invoiceId ? (
                      <Link href={`/invoices/${p.invoiceId}`} className="underline">
                        invoice
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">
                        {PAID_VIA_LABELS[p.paidVia].toLowerCase()}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <ol className="grid gap-1.5 border-t pt-3 text-muted-foreground">
              {data.events.map((e) => (
                <li key={e.id}>
                  <span className="text-foreground">{e.body}</span> · {stamp.format(e.createdAt)}
                </li>
              ))}
            </ol>
          </Card>
        </section>
      </div>
    </div>
  )
}
