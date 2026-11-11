import { can, requirePermission } from "@templates/auth/guards"
import { getMembershipSettings, todaysCheckIns } from "@templates/memberships"
import { Card, PageHeader } from "@templates/ui/card"
import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { CheckInDesk, VoidCheckInButton } from "@/components/memberships"

export const metadata: Metadata = { title: "Check-in desk" }

export default async function DeskPage() {
  const ctx = await requirePermission({ membership: ["checkin"] }).catch(() =>
    redirect("/memberships"),
  )
  const [visits, settings, canManage] = await Promise.all([
    todaysCheckIns(ctx),
    getMembershipSettings(ctx),
    can({ membership: ["manage"] }),
  ])
  const time = new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: settings.timeZone,
  })
  const counted = visits.filter((v) => !v.voidedAt).length
  return (
    <div className="mx-auto grid w-full max-w-2xl gap-6">
      <PageHeader title="Check-in desk" description="Scan a member's card, or search by name." />
      <CheckInDesk />
      <section aria-labelledby="today" className="grid gap-3">
        <h2 id="today" className="font-semibold">
          Today · {counted} {counted === 1 ? "visit" : "visits"}
        </h2>
        <Card className="overflow-hidden p-0">
          {visits.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">Nobody yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {visits.map((v) => {
                const recent =
                  Date.now() - v.at.getTime() < 15 * 60_000 && v.checkedInBy === ctx.user.id
                return (
                  <li key={v.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <span className={v.voidedAt ? "text-muted-foreground line-through" : ""}>
                      <span className="tabular-nums">{time.format(v.at)}</span> ·{" "}
                      <Link
                        href={`/memberships/${v.membershipId}`}
                        className="font-medium hover:underline"
                      >
                        {v.memberName}
                      </Link>
                      <span className="text-muted-foreground"> · {v.planName}</span>
                    </span>
                    {!v.voidedAt && (canManage || recent) && <VoidCheckInButton id={v.id} />}
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </section>
    </div>
  )
}
