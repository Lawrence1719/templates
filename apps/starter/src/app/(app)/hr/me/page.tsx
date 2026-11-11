import { requirePermission } from "@templates/auth/guards"
import { getHrSettings, leaveBalances, listLeave, listLeaveTypes, myClock } from "@templates/hr"
import {
  formatDays,
  formatHours,
  LEAVE_STATUS_LABELS,
  leaveYearLabel,
  today,
} from "@templates/hr/definitions"
import { Card, PageHeader } from "@templates/ui/card"
import { cn } from "@templates/ui/cn"
import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { CancelLeaveButton, ClockCard, LeaveForm } from "@/components/hr"
import { entryView, formatRange } from "@/components/hr-format"

export const metadata: Metadata = { title: "My time & leave" }

export default async function MyHrPage() {
  const ctx = await requirePermission({ hr: ["self"] }).catch(() => redirect("/dashboard"))
  const me = {
    orgId: ctx.orgId,
    user: { id: ctx.user.id, name: ctx.user.name, email: ctx.user.email },
  }
  const clock = await myClock(me)
  if (!clock)
    return (
      <div className="mx-auto grid w-full max-w-2xl gap-6">
        <PageHeader title="My time & leave" />
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Your account isn't linked to an employee record yet. Ask HR to link it, then you can clock
          in and ask for leave here.
        </Card>
      </div>
    )
  const [balances, requests, types, settings] = await Promise.all([
    leaveBalances(ctx, clock.employee.id),
    listLeave(ctx, { employeeId: clock.employee.id, limit: 50 }),
    listLeaveTypes(ctx),
    getHrSettings(ctx),
  ])
  const t = today(settings.timeZone)

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6">
      <PageHeader
        title="My time & leave"
        description={`${clock.employee.name}${clock.employee.jobTitle ? ` · ${clock.employee.jobTitle}` : ""}`}
      />
      {clock.employee.status === "active" ? (
        <div className="grid gap-6 md:grid-cols-2">
          <ClockCard
            openSince={clock.open?.clockIn.toISOString() ?? null}
            todayMinutes={clock.todayMinutes}
            weekMinutes={clock.weekMinutes}
          />
          <Card className="grid content-start gap-3 p-5">
            <h2 className="font-semibold">This week</h2>
            {clock.entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No time yet this week.</p>
            ) : (
              <ul className="divide-y text-sm">
                {clock.entries.map((e) => {
                  const v = entryView(e, clock.timeZone)
                  return (
                    <li key={e.id} className="flex justify-between gap-2 py-2">
                      <span>{v.label}</span>
                      <span className="tabular-nums">
                        {e.clockOut ? formatHours(e.minutes) : "open"}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        </div>
      ) : (
        <Card className="p-5 text-sm text-muted-foreground">Your record is marked as left.</Card>
      )}

      <section aria-labelledby="balances" className="grid gap-3">
        <h2 id="balances" className="font-semibold">
          Leave in {leaveYearLabel(balances.year, balances.startMonth)}
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {balances.types.map((b) => (
            <li key={b.type.id} className="rounded-xl border px-4 py-3">
              <p className="text-sm text-muted-foreground">{b.type.name}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {b.tracked
                  ? `${formatDays(b.remainingHalfDays ?? 0)} left`
                  : `${formatDays(b.takenHalfDays)} taken`}
              </p>
              <p className="text-xs text-muted-foreground">
                {b.tracked
                  ? `${formatDays((b.allowanceHalfDays ?? 0) + b.adjustmentHalfDays)} a year · ${formatDays(b.takenHalfDays)} taken`
                  : "No limit"}
                {b.pendingHalfDays > 0 && ` · ${formatDays(b.pendingHalfDays)} waiting`}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {clock.employee.status === "active" && (
        <Card className="grid gap-3 p-5">
          <h2 className="font-semibold">Ask for leave</h2>
          <LeaveForm types={types.map((x) => ({ id: x.id, name: x.name }))} />
        </Card>
      )}

      <section aria-labelledby="requests" className="grid gap-3">
        <h2 id="requests" className="font-semibold">
          My requests
        </h2>
        <Card className="overflow-hidden p-0">
          {requests.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">No leave yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {requests.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                >
                  <span>
                    <span className="font-medium">{r.typeName}</span> ·{" "}
                    {formatRange(r.startDay, r.endDay, r.halfDay)} · {formatDays(r.halfDays)}
                    {r.decisionNote && (
                      <span className="block text-xs text-muted-foreground">
                        “{r.decisionNote}”
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "text-xs",
                        r.status === "approved" && "text-success",
                        r.status === "pending" && "text-warning",
                        (r.status === "rejected" || r.status === "cancelled") &&
                          "text-muted-foreground",
                      )}
                    >
                      {LEAVE_STATUS_LABELS[r.status]}
                    </span>
                    {(r.status === "pending" || (r.status === "approved" && r.startDay > t)) && (
                      <CancelLeaveButton id={r.id} />
                    )}
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
