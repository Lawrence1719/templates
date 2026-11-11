import { can, requirePermission } from "@templates/auth/guards"
import { getHrSettings, listLeave, whoIsOff } from "@templates/hr"
import { addDays, formatDays, LEAVE_STATUS_LABELS, today } from "@templates/hr/definitions"
import { Card, PageHeader } from "@templates/ui/card"
import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { CancelLeaveButton, DecisionForm } from "@/components/hr"
import { formatRange } from "@/components/hr-format"

export const metadata: Metadata = { title: "Leave" }

const stamp = new Intl.DateTimeFormat("en", { dateStyle: "medium" })

export default async function LeavePage() {
  const ctx = await requirePermission({ hr: ["approve"] }).catch(() => redirect("/hr"))
  const settings = await getHrSettings(ctx)
  const t = today(settings.timeZone)
  const [pending, upcoming, recent, canManage] = await Promise.all([
    listLeave(ctx, { status: "pending" }),
    whoIsOff(ctx, t, addDays(t, 30)),
    listLeave(ctx, { limit: 15 }),
    can({ hr: ["manage"] }),
  ])
  const decided = recent.filter((r) => r.status !== "pending")

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6">
      <PageHeader
        title="Leave"
        description="Requests to decide, and who's off in the next 30 days."
      />

      <section aria-labelledby="waiting" className="grid gap-3">
        <h2 id="waiting" className="font-semibold">
          Waiting for you · {pending.length}
        </h2>
        {pending.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">Nothing to decide.</Card>
        ) : (
          <ul className="grid gap-3">
            {pending.map((r) => (
              <li key={r.id} className="grid gap-3 rounded-xl border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p>
                    <Link
                      href={`/hr/employees/${r.employeeId}`}
                      className="font-medium hover:underline"
                    >
                      {r.employeeName}
                    </Link>{" "}
                    · {r.typeName}
                    {!r.paid && " (unpaid)"} · {formatDays(r.halfDays)}
                  </p>
                  <p className="text-sm text-muted-foreground">asked {stamp.format(r.createdAt)}</p>
                </div>
                <p className="text-sm">
                  {formatRange(r.startDay, r.endDay, r.halfDay)}
                  {r.reason && <span className="text-muted-foreground"> · “{r.reason}”</span>}
                </p>
                {r.employeeUserId === ctx.user.id ? (
                  <p className="text-sm text-muted-foreground">
                    Your own request: someone else decides it.
                  </p>
                ) : (
                  <DecisionForm id={r.id} />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="off" className="grid gap-3">
        <h2 id="off" className="font-semibold">
          Off in the next 30 days
        </h2>
        <Card className="overflow-hidden p-0">
          {upcoming.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">Everyone's in.</p>
          ) : (
            <ul className="divide-y text-sm">
              {upcoming.map((o) => (
                <li
                  key={`${o.employeeId}-${o.startDay}`}
                  className="flex justify-between gap-2 px-4 py-2.5"
                >
                  <span className="font-medium">{o.name}</span>
                  <span className="text-muted-foreground">
                    {formatRange(o.startDay, o.endDay, o.halfDay)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section aria-labelledby="decided" className="grid gap-3">
        <h2 id="decided" className="font-semibold">
          Recently decided
        </h2>
        <Card className="overflow-hidden p-0">
          {decided.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">Nothing yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {decided.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
                >
                  <span>
                    <span className="font-medium">{r.employeeName}</span> · {r.typeName} ·{" "}
                    {formatRange(r.startDay, r.endDay, r.halfDay)}
                  </span>
                  <span className="flex items-center gap-2 text-muted-foreground">
                    {LEAVE_STATUS_LABELS[r.status]}
                    {r.decidedByName && ` by ${r.decidedByName}`}
                    {canManage && r.status === "approved" && <CancelLeaveButton id={r.id} />}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  )
}
