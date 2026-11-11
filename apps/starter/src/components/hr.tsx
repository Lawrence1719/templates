"use client"

import {
  CURRENCIES,
  EMPLOYMENT_LABELS,
  EMPLOYMENT_TYPES,
  formatHours,
  PAY_LABELS,
  PAY_TYPES,
  WEEKDAY_LABELS,
  WEEKDAYS,
} from "@templates/hr/definitions"
import { Button } from "@templates/ui/button"
import { cn } from "@templates/ui/cn"
import { ErrorText } from "@templates/ui/form"
import { Clock, Trash2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState, useTransition } from "react"

import {
  addAdjustmentAction,
  addHolidayAction,
  cancelLeaveAction,
  clockInAction,
  clockOutAction,
  decideLeaveAction,
  deleteDepartmentAction,
  deleteEmployeeAction,
  deleteHolidayAction,
  deleteTimeEntryAction,
  type HrResult,
  recordLeaveAction,
  requestLeaveAction,
  saveDepartmentAction,
  saveEmployeeAction,
  saveHrSettingsAction,
  saveLeaveTypeAction,
  saveTimeEntryAction,
  setLeaveTypeStatusAction,
} from "@/app/actions/hr"
import { Choice, Input } from "@/components/fields"

type Option = { id: string; name: string }

function useAction() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [result, setResult] = useState<HrResult | null>(null)
  const submit = (fn: () => Promise<HrResult>, onOk?: (r: HrResult & { ok: true }) => void) =>
    start(async () => {
      const r = await fn()
      setResult(r)
      if (r.ok) {
        onOk?.(r)
        router.refresh()
      }
    })
  const errors = result && !result.ok ? (result.fieldErrors ?? {}) : {}
  const formError = result && !result.ok && !result.fieldErrors ? result.error : null
  return { pending, submit, errors, formError, ok: !!result?.ok, reset: () => setResult(null) }
}

const str = (f: FormData, k: string) => String(f.get(k) ?? "")

// ---------- Time clock ----------

/** Clock in and out. The running timer ticks in the browser; the server keeps the real times. */
export function ClockCard({
  openSince,
  todayMinutes,
  weekMinutes,
}: {
  openSince: string | null
  todayMinutes: number
  weekMinutes: number
}) {
  const { pending, submit, formError } = useAction()
  const [note, setNote] = useState("")
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!openSince) return
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [openSince])
  const running = openSince
    ? Math.max(0, Math.floor((now - new Date(openSince).getTime()) / 60_000))
    : 0
  const time = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" })
  return (
    <div className="grid gap-4 rounded-xl border p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            {openSince ? "Clocked in" : "Clocked out"}
          </p>
          <p className="text-3xl font-semibold tabular-nums" aria-live="polite">
            {openSince ? formatHours(running) : "—"}
          </p>
          {openSince && (
            <p className="text-sm text-muted-foreground">
              since {time.format(new Date(openSince))}
            </p>
          )}
        </div>
        <span
          className={cn(
            "grid size-10 place-items-center rounded-full [&_svg]:size-5",
            openSince ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
          )}
        >
          <Clock />
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-muted-foreground">Today</dt>
          <dd className="font-medium tabular-nums">{formatHours(todayMinutes)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">This week</dt>
          <dd className="font-medium tabular-nums">{formatHours(weekMinutes)}</dd>
        </div>
      </dl>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          submit(
            () => (openSince ? clockOutAction(note) : clockInAction(note)),
            () => setNote(""),
          )
        }}
      >
        <input
          aria-label="Note (optional)"
          placeholder="Note (optional)"
          maxLength={300}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="h-10 min-w-0 flex-1 rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button className="h-10 px-6" variant={openSince ? "ghost" : "primary"} disabled={pending}>
          {pending ? "Saving…" : openSince ? "Clock out" : "Clock in"}
        </Button>
      </form>
      <ErrorText>{formError}</ErrorText>
    </div>
  )
}

// ---------- Leave ----------

/** Ask for leave (self) or record approved leave for someone (HR, with `employeeId`). */
export function LeaveForm({ types, employeeId }: { types: Option[]; employeeId?: string }) {
  const { pending, submit, errors, formError, ok } = useAction()
  const [single, setSingle] = useState(false)
  if (types.length === 0)
    return <p className="text-sm text-muted-foreground">No leave types are set up yet.</p>
  return (
    <form
      noValidate
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        const form = e.currentTarget
        const f = new FormData(form)
        const input = {
          leaveTypeId: str(f, "leaveTypeId"),
          startDay: str(f, "startDay"),
          endDay: str(f, "endDay") || str(f, "startDay"),
          halfDay: f.get("halfDay") === "on",
          reason: str(f, "reason"),
        }
        submit(
          () => (employeeId ? recordLeaveAction(employeeId, input) : requestLeaveAction(input)),
          () => form.reset(),
        )
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Choice label="Kind of leave" name="leaveTypeId" error={errors.leaveTypeId}>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Choice>
        <Input
          label="First day"
          name="startDay"
          type="date"
          error={errors.startDay}
          onChange={(e) => {
            const end = e.currentTarget.form?.elements.namedItem(
              "endDay",
            ) as HTMLInputElement | null
            if (end && (!end.value || end.value < e.currentTarget.value))
              end.value = e.currentTarget.value
            setSingle(!!end && end.value === e.currentTarget.value)
          }}
        />
        <Input
          label="Last day"
          name="endDay"
          type="date"
          error={errors.endDay}
          onChange={(e) => {
            const start = e.currentTarget.form?.elements.namedItem(
              "startDay",
            ) as HTMLInputElement | null
            setSingle(!!start && start.value === e.currentTarget.value)
          }}
        />
      </div>
      {single && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="halfDay" className="size-4" /> Half day
        </label>
      )}
      <ErrorText>{errors.halfDay}</ErrorText>
      <Input label="Reason (optional)" name="reason" maxLength={500} error={errors.reason} />
      <ErrorText>{formError}</ErrorText>
      <div className="flex items-center gap-3">
        <Button disabled={pending}>
          {pending ? "Saving…" : employeeId ? "Record approved leave" : "Ask for leave"}
        </Button>
        {ok && (
          <span className="text-sm text-success">
            {employeeId ? "Recorded" : "Sent for approval"}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Only work days count; weekends and holidays are skipped.
      </p>
    </form>
  )
}

export function CancelLeaveButton({ id, label = "Cancel" }: { id: string; label?: string }) {
  const { pending, submit, formError } = useAction()
  return (
    <span className="inline-grid gap-1">
      <Button
        variant="quiet"
        size="sm"
        disabled={pending}
        onClick={() => {
          if (confirm("Cancel this leave?")) submit(() => cancelLeaveAction(id))
        }}
      >
        {pending ? "Cancelling…" : label}
      </Button>
      <ErrorText>{formError}</ErrorText>
    </span>
  )
}

export function DecisionForm({ id }: { id: string }) {
  const { pending, submit, formError } = useAction()
  const [note, setNote] = useState("")
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <input
          aria-label="Note to them (optional)"
          placeholder="Note (optional)"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          className="h-8 min-w-0 flex-1 rounded-md border bg-transparent px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button
          size="sm"
          disabled={pending}
          onClick={() => submit(() => decideLeaveAction(id, true, note))}
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => submit(() => decideLeaveAction(id, false, note))}
        >
          Decline
        </Button>
      </div>
      <ErrorText>{formError}</ErrorText>
    </div>
  )
}

export function AdjustmentForm({
  employeeId,
  types,
  year,
}: {
  employeeId: string
  types: Option[]
  year: number
}) {
  const { pending, submit, errors, formError, ok } = useAction()
  if (types.length === 0) return null
  return (
    <form
      noValidate
      className="grid gap-3 sm:grid-cols-[1fr_6rem_1fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault()
        const form = e.currentTarget
        const f = new FormData(form)
        submit(
          () =>
            addAdjustmentAction(employeeId, {
              leaveTypeId: str(f, "leaveTypeId"),
              year,
              days: str(f, "days"),
              reason: str(f, "reason"),
            }),
          () => form.reset(),
        )
      }}
    >
      <Choice label="Leave" name="leaveTypeId" error={errors.leaveTypeId}>
        {types.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </Choice>
      <Input label="Days (±)" name="days" inputMode="decimal" placeholder="1" error={errors.days} />
      <Input
        label="Why"
        name="reason"
        maxLength={200}
        placeholder="Carried over"
        error={errors.reason}
      />
      <Button variant="ghost" disabled={pending}>
        Adjust
      </Button>
      <div className="sm:col-span-4">
        <ErrorText>{formError}</ErrorText>
        {ok && <span className="text-sm text-success">Saved</span>}
      </div>
    </form>
  )
}

// ---------- Time entries (HR) ----------

export function TimeEntryForm({
  employeeId,
  entry,
  onDone,
}: {
  employeeId: string
  entry?: { id: string; day: string; start: string; end: string; overnight: boolean; note: string }
  onDone?: () => void
}) {
  const { pending, submit, errors, formError } = useAction()
  return (
    <form
      noValidate
      className="grid gap-3 sm:grid-cols-[1fr_6rem_6rem_1fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault()
        const form = e.currentTarget
        const f = new FormData(form)
        submit(
          () =>
            saveTimeEntryAction(employeeId, entry?.id ?? null, {
              day: str(f, "day"),
              start: str(f, "start"),
              end: str(f, "end"),
              overnight: f.get("overnight") === "on",
              note: str(f, "note"),
            }),
          () => {
            if (!entry) form.reset()
            onDone?.()
          },
        )
      }}
    >
      <Input label="Day" name="day" type="date" defaultValue={entry?.day} error={errors.day} />
      <Input label="In" name="start" type="time" defaultValue={entry?.start} error={errors.start} />
      <Input label="Out" name="end" type="time" defaultValue={entry?.end} error={errors.end} />
      <Input
        label="Note"
        name="note"
        maxLength={300}
        defaultValue={entry?.note}
        error={errors.note}
      />
      <Button variant="ghost" disabled={pending}>
        {entry ? "Save" : "Add time"}
      </Button>
      <label className="flex items-center gap-2 text-xs text-muted-foreground sm:col-span-5">
        <input
          type="checkbox"
          name="overnight"
          defaultChecked={entry?.overnight}
          className="size-4"
        />
        Ends the next day
      </label>
      {formError && (
        <div className="sm:col-span-5">
          <ErrorText>{formError}</ErrorText>
        </div>
      )}
    </form>
  )
}

export function TimeEntryRow({
  employeeId,
  entry,
  label,
  canEdit,
}: {
  employeeId: string
  entry: {
    id: string
    day: string
    start: string
    end: string
    overnight: boolean
    note: string
    minutes: number
    edited: boolean
    manual: boolean
  }
  label: string
  canEdit: boolean
}) {
  const [editing, setEditing] = useState(false)
  const { pending, submit, formError } = useAction()
  if (editing)
    return (
      <li className="py-3">
        <TimeEntryForm employeeId={employeeId} entry={entry} onDone={() => setEditing(false)} />
      </li>
    )
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
      <span>
        {label}
        {entry.note && <span className="text-muted-foreground"> · {entry.note}</span>}
        {(entry.edited || entry.manual) && (
          <span className="ml-1 text-xs text-muted-foreground">
            ({entry.edited ? "corrected" : "added by HR"})
          </span>
        )}
      </span>
      <span className="flex items-center gap-2">
        <span className="tabular-nums">{entry.end ? formatHours(entry.minutes) : "open"}</span>
        {canEdit && (
          <>
            <Button variant="quiet" size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <button
              type="button"
              aria-label="Delete this entry"
              disabled={pending}
              className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-danger/10 hover:text-danger [&_svg]:size-4"
              onClick={() => {
                if (confirm("Delete this time entry?"))
                  submit(() => deleteTimeEntryAction(entry.id))
              }}
            >
              <Trash2 />
            </button>
          </>
        )}
      </span>
      <ErrorText>{formError}</ErrorText>
    </li>
  )
}

// ---------- Employee editor ----------

export type EmployeeFormValues = {
  name: string
  userId: string
  workEmail: string
  phone: string
  jobTitle: string
  departmentId: string
  managerId: string
  employmentType: string
  startDate: string
  endDate: string
  status: string
  payType: string
  payRate: string
  payCurrency: string
  birthDate: string
  homeAddress: string
  emergencyContactName: string
  emergencyContactPhone: string
  privateNotes: string
}

export function EmployeeForm({
  id,
  initial,
  members,
  departments,
  managers,
}: {
  id: string | null
  initial: EmployeeFormValues
  members: { userId: string; name: string; email: string; taken: boolean }[]
  departments: Option[]
  managers: Option[]
}) {
  const router = useRouter()
  const { pending, submit, errors, formError } = useAction()
  const del = useAction()
  return (
    <form
      noValidate
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        const v = Object.fromEntries(
          [...f.entries()].map(([k, x]) => [k, String(x)]),
        ) as EmployeeFormValues
        submit(
          () =>
            saveEmployeeAction(id, {
              ...v,
              employmentType: v.employmentType as (typeof EMPLOYMENT_TYPES)[number],
              status: (v.status || "active") as "active" | "left",
              payType: v.payType as (typeof PAY_TYPES)[number] | "",
              payCurrency: v.payCurrency as (typeof CURRENCIES)[number] | "",
            }),
          (r) => router.push(`/hr/employees/${r.id}`),
        )
      }}
    >
      <section className="grid gap-4 sm:grid-cols-2">
        <h2 className="font-semibold sm:col-span-2">Work details</h2>
        <Input
          label="Name"
          name="name"
          defaultValue={initial.name}
          maxLength={120}
          error={errors.name}
        />
        <Input
          label="Job title"
          name="jobTitle"
          defaultValue={initial.jobTitle}
          maxLength={120}
          error={errors.jobTitle}
        />
        <Input
          label="Work email"
          name="workEmail"
          type="email"
          defaultValue={initial.workEmail}
          error={errors.workEmail}
        />
        <Input
          label="Phone"
          name="phone"
          defaultValue={initial.phone}
          maxLength={40}
          error={errors.phone}
        />
        <Choice
          label="Department"
          name="departmentId"
          defaultValue={initial.departmentId}
          error={errors.departmentId}
        >
          <option value="">None</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Choice>
        <Choice
          label="Reports to"
          name="managerId"
          defaultValue={initial.managerId}
          error={errors.managerId}
        >
          <option value="">Nobody</option>
          {managers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Choice>
        <Choice
          label="Type"
          name="employmentType"
          defaultValue={initial.employmentType}
          error={errors.employmentType}
        >
          {EMPLOYMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {EMPLOYMENT_LABELS[t]}
            </option>
          ))}
        </Choice>
        <Choice
          label="App account"
          name="userId"
          defaultValue={initial.userId}
          error={errors.userId}
        >
          <option value="">Not linked</option>
          {members.map((m) => (
            <option
              key={m.userId}
              value={m.userId}
              disabled={m.taken && m.userId !== initial.userId}
            >
              {m.name} ({m.email}){m.taken && m.userId !== initial.userId ? " · linked" : ""}
            </option>
          ))}
        </Choice>
        <Input
          label="Start date"
          name="startDate"
          type="date"
          defaultValue={initial.startDate}
          error={errors.startDate}
        />
        {id && (
          <>
            <Choice
              label="Status"
              name="status"
              defaultValue={initial.status}
              error={errors.status}
            >
              <option value="active">Active</option>
              <option value="left">Left</option>
            </Choice>
            <Input
              label="End date"
              name="endDate"
              type="date"
              defaultValue={initial.endDate}
              hint="Set when they leave (defaults to today)"
              error={errors.endDate}
            />
          </>
        )}
      </section>

      <section className="grid gap-4 rounded-xl border border-dashed p-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <h2 className="font-semibold">Private</h2>
          <p className="text-sm text-muted-foreground">Only people who manage HR can see these.</p>
        </div>
        <Choice label="Pay" name="payType" defaultValue={initial.payType} error={errors.payType}>
          <option value="">Not recorded</option>
          {PAY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t === "hourly" ? "Hourly" : "Salary"} ({PAY_LABELS[t]})
            </option>
          ))}
        </Choice>
        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <Input
            label="Rate"
            name="payRate"
            inputMode="decimal"
            defaultValue={initial.payRate}
            error={errors.payRate}
          />
          <Choice
            label="Currency"
            name="payCurrency"
            defaultValue={initial.payCurrency}
            error={errors.payCurrency}
          >
            <option value="">—</option>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Choice>
        </div>
        <Input
          label="Birthday"
          name="birthDate"
          type="date"
          defaultValue={initial.birthDate}
          error={errors.birthDate}
        />
        <Input
          label="Home address"
          name="homeAddress"
          defaultValue={initial.homeAddress}
          maxLength={500}
          error={errors.homeAddress}
        />
        <Input
          label="Emergency contact"
          name="emergencyContactName"
          defaultValue={initial.emergencyContactName}
          maxLength={120}
          error={errors.emergencyContactName}
        />
        <Input
          label="Emergency phone"
          name="emergencyContactPhone"
          defaultValue={initial.emergencyContactPhone}
          maxLength={40}
          error={errors.emergencyContactPhone}
        />
        <Input
          label="Notes"
          name="privateNotes"
          defaultValue={initial.privateNotes}
          maxLength={2000}
          className="sm:col-span-2"
          error={errors.privateNotes}
        />
      </section>

      <ErrorText>{formError}</ErrorText>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button disabled={pending}>
          {pending ? "Saving…" : id ? "Save changes" : "Add employee"}
        </Button>
        {id && (
          <span className="grid gap-1 text-right">
            <Button
              type="button"
              variant="danger"
              disabled={del.pending}
              onClick={() => {
                if (confirm("Delete this record? Only for records added by mistake."))
                  del.submit(
                    () => deleteEmployeeAction(id),
                    () => router.push("/hr"),
                  )
              }}
            >
              Delete record
            </Button>
            <ErrorText>{del.formError}</ErrorText>
          </span>
        )}
      </div>
    </form>
  )
}

// ---------- Setup ----------

const MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(2020, i, 1)),
  ),
)

export function HrSettingsForm({
  initial,
}: {
  initial: {
    timeZone: string
    workDays: number[]
    leaveYearStartMonth: number
    weeklyHours: number
  }
}) {
  const { pending, submit, errors, formError, ok } = useAction()
  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        submit(() =>
          saveHrSettingsAction({
            timeZone: str(f, "timeZone"),
            workDays: f.getAll("workDays").map(Number),
            leaveYearStartMonth: Number(str(f, "leaveYearStartMonth")),
            weeklyHours: Number(str(f, "weeklyHours")),
          }),
        )
      }}
    >
      <fieldset className="grid gap-1.5 text-sm">
        <legend className="mb-1.5 font-medium">Work days</legend>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((d) => (
            <label key={d} className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5">
              <input
                type="checkbox"
                name="workDays"
                value={d}
                defaultChecked={initial.workDays.includes(d)}
              />
              {WEEKDAY_LABELS[d]}
            </label>
          ))}
        </div>
        <ErrorText>{errors.workDays}</ErrorText>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-3">
        <Input
          label="Time zone"
          name="timeZone"
          defaultValue={initial.timeZone}
          error={errors.timeZone}
        />
        <Choice
          label="Leave year starts"
          name="leaveYearStartMonth"
          defaultValue={String(initial.leaveYearStartMonth)}
          error={errors.leaveYearStartMonth}
        >
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </Choice>
        <Input
          label="Hours per week"
          name="weeklyHours"
          inputMode="numeric"
          defaultValue={String(initial.weeklyHours)}
          hint="Time over this is overtime"
          error={errors.weeklyHours}
        />
      </div>
      <ErrorText>{formError}</ErrorText>
      <div className="flex items-center gap-3">
        <Button disabled={pending}>{pending ? "Saving…" : "Save settings"}</Button>
        {ok && <span className="text-sm text-success">Saved</span>}
      </div>
    </form>
  )
}

export function DepartmentEditor({
  departments,
}: {
  departments: (Option & { people: number })[]
}) {
  const { pending, submit, errors, formError } = useAction()
  const del = useAction()
  return (
    <div className="grid gap-3">
      <form
        noValidate
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const form = e.currentTarget
          submit(
            () => saveDepartmentAction(null, { name: str(new FormData(form), "name") }),
            () => form.reset(),
          )
        }}
      >
        <Input
          label="New department"
          name="name"
          maxLength={80}
          className="min-w-0 flex-1"
          error={errors.name}
        />
        <Button variant="ghost" disabled={pending}>
          Add
        </Button>
      </form>
      <ErrorText>{formError ?? del.formError}</ErrorText>
      <ul className="divide-y text-sm">
        {departments.map((d) => (
          <li key={d.id} className="flex items-center justify-between py-2">
            <span>
              {d.name}{" "}
              <span className="text-muted-foreground">
                · {d.people} {d.people === 1 ? "person" : "people"}
              </span>
            </span>
            <Button
              variant="quiet"
              size="sm"
              disabled={del.pending}
              onClick={() => del.submit(() => deleteDepartmentAction(d.id))}
            >
              Delete
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function LeaveTypeEditor({
  types,
}: {
  types: {
    id: string
    name: string
    allowanceHalfDays: number | null
    paid: boolean
    status: string
  }[]
}) {
  const { pending, submit, errors, formError } = useAction()
  const toggle = useAction()
  return (
    <div className="grid gap-3">
      <form
        noValidate
        className="grid gap-3 sm:grid-cols-[1fr_8rem_auto_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault()
          const form = e.currentTarget
          const f = new FormData(form)
          submit(
            () =>
              saveLeaveTypeAction(null, {
                name: str(f, "name"),
                allowance: str(f, "allowance"),
                paid: f.get("paid") === "on",
              }),
            () => form.reset(),
          )
        }}
      >
        <Input
          label="Kind of leave"
          name="name"
          maxLength={60}
          placeholder="Vacation"
          error={errors.name}
        />
        <Input
          label="Days a year"
          name="allowance"
          inputMode="decimal"
          placeholder="Blank = no limit"
          error={errors.allowance}
        />
        <label className="flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" name="paid" defaultChecked className="size-4" /> Paid
        </label>
        <Button variant="ghost" disabled={pending}>
          Add
        </Button>
      </form>
      <ErrorText>{formError ?? toggle.formError}</ErrorText>
      <ul className="divide-y text-sm">
        {types.map((t) => (
          <li key={t.id} className="flex items-center justify-between py-2">
            <span className={cn(t.status === "archived" && "text-muted-foreground line-through")}>
              {t.name}{" "}
              <span className="text-muted-foreground">
                ·{" "}
                {t.allowanceHalfDays === null
                  ? "no limit"
                  : `${t.allowanceHalfDays / 2} days a year`}{" "}
                · {t.paid ? "paid" : "unpaid"}
              </span>
            </span>
            <Button
              variant="quiet"
              size="sm"
              disabled={toggle.pending}
              onClick={() =>
                toggle.submit(() => setLeaveTypeStatusAction(t.id, t.status === "active"))
              }
            >
              {t.status === "active" ? "Archive" : "Restore"}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function HolidayEditor({
  holidays,
}: {
  holidays: { id: string; day: string; name: string }[]
}) {
  const { pending, submit, errors, formError } = useAction()
  const del = useAction()
  const fmt = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" })
  return (
    <div className="grid gap-3">
      <form
        noValidate
        className="grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault()
          const form = e.currentTarget
          const f = new FormData(form)
          submit(
            () => addHolidayAction({ day: str(f, "day"), name: str(f, "name") }),
            () => form.reset(),
          )
        }}
      >
        <Input label="Date" name="day" type="date" error={errors.day} />
        <Input label="Holiday" name="name" maxLength={80} error={errors.name} />
        <Button variant="ghost" disabled={pending}>
          Add
        </Button>
      </form>
      <ErrorText>{formError}</ErrorText>
      <ul className="divide-y text-sm">
        {holidays.map((h) => (
          <li key={h.id} className="flex items-center justify-between py-2">
            <span>
              <span className="tabular-nums">{fmt.format(new Date(`${h.day}T00:00:00Z`))}</span> ·{" "}
              {h.name}
            </span>
            <Button
              variant="quiet"
              size="sm"
              disabled={del.pending}
              onClick={() => del.submit(() => deleteHolidayAction(h.id))}
            >
              Remove
            </Button>
          </li>
        ))}
        {holidays.length === 0 && <li className="py-2 text-muted-foreground">No holidays yet.</li>}
      </ul>
    </div>
  )
}
