import { can, requirePermission } from "@templates/auth/guards"
import {
  getEmployee,
  HrError,
  leaveBalances,
  listLeave,
  listLeaveTypes,
  timesheet,
} from "@templates/hr"
import {
  addDays,
  EMPLOYMENT_LABELS,
  formatDays,
  formatHours,
  formatMoney,
  isDay,
  LEAVE_STATUS_LABELS,
  leaveYearLabel,
  PAY_LABELS,
} from "@templates/hr/definitions"
import { Card } from "@templates/ui/card"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import {
  AdjustmentForm,
  CancelLeaveButton,
  LeaveForm,
  TimeEntryForm,
  TimeEntryRow,
} from "@/components/hr"
import { entryView, formatHrDay, formatLongDay, formatRange } from "@/components/hr-format"

export const metadata: Metadata = { title: "Employee" }

export default async function EmployeePage({
  params,
  searchParams,
}: PageProps<"/hr/employees/[id]">) {
  const ctx = await requirePermission({ hr: ["read"] }).catch(() => redirect("/hr"))
  const { id } = await params
  const sp = await searchParams
  const w = Array.isArray(sp.week) ? sp.week[0] : sp.week
  const canManage = await can({ hr: ["manage"] })
  const data = await getEmployee(ctx, id, { showPrivate: canManage }).catch((e) => {
    if (e instanceof HrError && e.status === 404) notFound()
    throw e
  })
  const [balances, leave, types, sheet] = await Promise.all([
    leaveBalances(ctx, id),
    listLeave(ctx, { employeeId: id, limit: 30 }),
    listLeaveTypes(ctx),
    timesheet(ctx, { week: w && isDay(w) ? w : undefined, employeeIds: [id] }),
  ])
  const e = data.employee
  const mine = sheet.people[0]
  const typeOptions = types.map((t) => ({ id: t.id, name: t.name }))
  const detail = (label: string, value: string | null | undefined) => (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-2 py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value || "—"}</dd>
    </div>
  )

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/hr" className="text-sm text-muted-foreground hover:underline">
            ← Staff
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{e.name}</h1>
          <p className="text-sm text-muted-foreground">
            {[e.jobTitle, data.department?.name, EMPLOYMENT_LABELS[e.employmentType]]
              .filter(Boolean)
              .join(" · ")}
            {e.status === "left" && ` · left ${e.endDate ? formatLongDay(e.endDate) : ""}`}
          </p>
        </div>
        {canManage && (
          <Link
            href={`/hr/employees/${id}/edit`}
            className="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium hover:bg-accent"
          >
            Edit
          </Link>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-2 font-semibold">Details</h2>
          <dl className="divide-y text-sm">
            {detail("Work email", e.workEmail)}
            {detail("Phone", e.phone)}
            {detail("Started", formatLongDay(e.startDate))}
            {detail("Reports to", data.manager?.name)}
            {detail("App account", data.account ? data.account.email : "Not linked")}
            {data.reports.length > 0 &&
              detail("Their team", data.reports.map((r) => r.name).join(", "))}
          </dl>
        </Card>
        {canManage && (
          <Card className="border-dashed p-5">
            <h2 className="mb-2 font-semibold">Private</h2>
            <dl className="divide-y text-sm">
              {detail(
                "Pay",
                e.payRateCents !== null && e.payType && e.payCurrency
                  ? `${formatMoney(e.payRateCents, e.payCurrency)} ${PAY_LABELS[e.payType]}`
                  : null,
              )}
              {detail("Birthday", e.birthDate ? formatLongDay(e.birthDate) : null)}
              {detail("Home address", e.homeAddress)}
              {detail(
                "Emergency contact",
                [e.emergencyContactName, e.emergencyContactPhone].filter(Boolean).join(" · "),
              )}
              {detail("Notes", e.privateNotes)}
            </dl>
          </Card>
        )}
      </div>

      <section aria-labelledby="leave" className="grid gap-3">
        <h2 id="leave" className="font-semibold">
          Leave in {leaveYearLabel(balances.year, balances.startMonth)}
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {balances.types.map((b) => (
            <li key={b.type.id} className="rounded-xl border px-4 py-3 text-sm">
              <p className="text-muted-foreground">{b.type.name}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">
                {b.tracked
                  ? `${formatDays(b.remainingHalfDays ?? 0)} left`
                  : `${formatDays(b.takenHalfDays)} taken`}
              </p>
              <p className="text-xs text-muted-foreground">
                {b.tracked &&
                  `${formatDays(b.allowanceHalfDays ?? 0)}${b.adjustmentHalfDays ? ` ${b.adjustmentHalfDays > 0 ? "+" : "−"} ${formatDays(Math.abs(b.adjustmentHalfDays))}` : ""} · ${formatDays(b.takenHalfDays)} taken`}
                {b.pendingHalfDays > 0 && ` · ${formatDays(b.pendingHalfDays)} waiting`}
              </p>
            </li>
          ))}
        </ul>
        {canManage && e.status === "active" && (
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="grid content-start gap-3 p-5">
              <h3 className="font-medium">Record leave</h3>
              <LeaveForm types={typeOptions} employeeId={id} />
            </Card>
            <Card className="grid content-start gap-3 p-5">
              <h3 className="font-medium">Adjust the balance</h3>
              <p className="text-sm text-muted-foreground">
                Carry-over, extra days or a correction for this leave year.
              </p>
              <AdjustmentForm
                employeeId={id}
                year={balances.year}
                types={types
                  .filter((t) => t.allowanceHalfDays !== null)
                  .map((t) => ({ id: t.id, name: t.name }))}
              />
            </Card>
          </div>
        )}
        <Card className="overflow-hidden p-0">
          {leave.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No leave on record.</p>
          ) : (
            <ul className="divide-y text-sm">
              {leave.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
                >
                  <span>
                    <span className="font-medium">{r.typeName}</span> ·{" "}
                    {formatRange(r.startDay, r.endDay, r.halfDay)} · {formatDays(r.halfDays)}
                  </span>
                  <span className="flex items-center gap-2 text-muted-foreground">
                    {LEAVE_STATUS_LABELS[r.status]}
                    {canManage && (r.status === "approved" || r.status === "pending") && (
                      <CancelLeaveButton id={r.id} />
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section aria-labelledby="time" className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="time" className="font-semibold">
            Time, week of {formatHrDay(sheet.weekStart)}
          </h2>
          <div className="flex gap-2 text-sm">
            <Link
              href={`/hr/employees/${id}?week=${addDays(sheet.weekStart, -7)}`}
              className="rounded-md border px-3 py-1 hover:bg-accent"
            >
              ←
            </Link>
            <Link
              href={`/hr/employees/${id}?week=${addDays(sheet.weekStart, 7)}`}
              className="rounded-md border px-3 py-1 hover:bg-accent"
            >
              →
            </Link>
          </div>
        </div>
        <Card className="grid gap-3 p-5">
          {mine ? (
            <>
              <ul className="divide-y">
                {mine.entries.map((x) => {
                  const v = entryView(x, sheet.timeZone)
                  return (
                    <TimeEntryRow
                      key={x.id}
                      employeeId={id}
                      entry={v.entry}
                      label={v.label}
                      canEdit={canManage}
                    />
                  )
                })}
              </ul>
              <p className="text-sm">
                Total{" "}
                <span className="font-medium tabular-nums">{formatHours(mine.totalMinutes)}</span>
                {mine.overtimeMinutes > 0 && (
                  <span className="text-warning">
                    {" "}
                    · {formatHours(mine.overtimeMinutes)} overtime
                  </span>
                )}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No time this week.</p>
          )}
          {canManage && (
            <div className="border-t pt-3">
              <TimeEntryForm employeeId={id} />
            </div>
          )}
        </Card>
      </section>
    </div>
  )
}
