"use client"

import {
  CURRENCIES,
  formatClock,
  formatTime,
  type ServiceInput,
  type SettingsInput,
  SLOT_STEPS,
  type StaffBookingInput,
  WEEKDAY_LABELS,
} from "@templates/bookings/definitions"
import { Button } from "@templates/ui/button"
import { cn } from "@templates/ui/cn"
import { ErrorText, Select } from "@templates/ui/form"
import { Check, Copy, Plus, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState, useTransition } from "react"

import {
  addTimeOffAction,
  type BookingResult,
  createBookingAction,
  deleteTimeOffAction,
  rotateLinkAction,
  saveResourceAction,
  saveServiceAction,
  saveSettingsAction,
  setBookingStatusAction,
  setHoursAction,
  setResourceStatusAction,
  setServiceStatusAction,
  staffSlotsAction,
} from "@/app/actions/bookings"
import { Choice, control, Input, Labeled } from "@/components/fields"

type Option = { id: string; name: string }

function useBookingAction() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [result, setResult] = useState<BookingResult | null>(null)
  const submit = (
    fn: () => Promise<BookingResult>,
    onOk?: (r: BookingResult & { ok: true }) => void,
  ) =>
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

// ---------- Staff booking ----------

export function StaffBookingForm({
  services,
  resources,
  customers,
  timeZone,
  defaultDay,
}: {
  services: (Option & { durationMinutes: number; resourceIds: string[] })[]
  resources: Option[]
  customers: (Option & { email: string | null; phone: string | null })[]
  timeZone: string
  defaultDay: string
}) {
  const router = useRouter()
  const { pending, submit, errors, formError } = useBookingAction()
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "")
  const svc = services.find((s) => s.id === serviceId)
  const allowed = resources.filter(
    (r) => !svc?.resourceIds.length || svc.resourceIds.includes(r.id),
  )
  const [resourceId, setResourceId] = useState(allowed[0]?.id ?? "")
  const [day, setDay] = useState(defaultDay)
  const [slots, setSlots] = useState<string[] | null>(null)
  const [startsAt, setStartsAt] = useState("")
  const [loading, startLoading] = useTransition()
  const [cust, setCust] = useState({ id: "", name: "", email: "", phone: "" })

  useEffect(() => {
    if (!allowed.some((r) => r.id === resourceId)) setResourceId(allowed[0]?.id ?? "")
  }, [allowed, resourceId])
  useEffect(() => {
    setStartsAt("")
    if (!serviceId || !resourceId || !day) return setSlots(null)
    startLoading(async () => setSlots(await staffSlotsAction(serviceId, resourceId, day)))
  }, [serviceId, resourceId, day])

  return (
    <form
      noValidate
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        const input: StaffBookingInput = {
          serviceId,
          resourceId,
          startsAt,
          customerId: cust.id || null,
          customerName: cust.name,
          customerEmail: cust.email,
          customerPhone: cust.phone,
          notes: String(f.get("notes") ?? ""),
        }
        submit(
          () => createBookingAction(input),
          (r) => r.id && router.push(`/bookings/${r.id}`),
        )
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Choice
          label="Service"
          value={serviceId}
          onChange={(e) => setServiceId(e.target.value)}
          error={errors.serviceId}
        >
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.durationMinutes} min)
            </option>
          ))}
        </Choice>
        <Choice
          label="With"
          value={resourceId}
          onChange={(e) => setResourceId(e.target.value)}
          error={errors.resourceId}
        >
          {allowed.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Choice>
        <Input label="Day" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">
          Time <span className="font-normal text-muted-foreground">({timeZone})</span>
        </legend>
        {loading ? (
          <p className="text-sm text-muted-foreground">Finding free times…</p>
        ) : slots && slots.length === 0 ? (
          <p className="text-sm text-muted-foreground">No free times that day.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {slots?.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={startsAt === s}
                onClick={() => setStartsAt(s)}
                className={cn(
                  "h-9 rounded-md border px-3 text-sm tabular-nums",
                  startsAt === s
                    ? "border-foreground bg-foreground text-background"
                    : "hover:bg-accent",
                )}
              >
                {formatTime(new Date(s), timeZone)}
              </button>
            ))}
          </div>
        )}
        {(errors.startsAt || (!startsAt && Object.keys(errors).length > 0)) && (
          <span className="text-xs text-danger">{errors.startsAt ?? "Choose a time"}</span>
        )}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        {customers.length > 0 && (
          <Choice
            label="Existing customer"
            value={cust.id}
            className="sm:col-span-2"
            onChange={(e) => {
              const c = customers.find((x) => x.id === e.target.value)
              setCust(
                c
                  ? { id: c.id, name: c.name, email: c.email ?? "", phone: c.phone ?? "" }
                  : { ...cust, id: "" },
              )
            }}
          >
            <option value="">New person / walk-in</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Choice>
        )}
        <Input
          label="Name"
          value={cust.name}
          onChange={(e) => setCust({ ...cust, name: e.target.value })}
          error={errors.customerName}
        />
        <Input
          label="Phone"
          type="tel"
          value={cust.phone}
          onChange={(e) => setCust({ ...cust, phone: e.target.value })}
          error={errors.customerPhone}
        />
        <Input
          label="Email"
          type="email"
          value={cust.email}
          onChange={(e) => setCust({ ...cust, email: e.target.value })}
          error={errors.customerEmail}
          hint="Optional. Not emailed for staff bookings."
        />
        <Input label="Notes" name="notes" maxLength={1000} error={errors.notes} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending || !startsAt}>{pending ? "Booking…" : "Book"}</Button>
        <ErrorText>{formError}</ErrorText>
      </div>
    </form>
  )
}

export function BookingStatusActions({
  id,
  status,
  started,
}: {
  id: string
  status: string
  started: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const act = (next: string, reason?: string) =>
    start(async () => {
      setError(null)
      const r = await setBookingStatusAction(id, next, reason)
      if (!r.ok) setError(r.error)
      router.refresh()
    })
  const live = status === "pending" || status === "confirmed"
  return (
    <div className="grid justify-items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        {status === "pending" && (
          <Button disabled={pending} onClick={() => act("confirmed")}>
            Confirm
          </Button>
        )}
        {status === "confirmed" && started && (
          <>
            <Button disabled={pending} onClick={() => act("completed")}>
              Mark completed
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => act("no_show")}>
              No-show
            </Button>
          </>
        )}
        {live && (
          <Button
            variant="danger"
            disabled={pending}
            onClick={() => {
              const reason = prompt("Cancel this booking? You can add a reason for the customer.")
              if (reason !== null) act("cancelled", reason)
            }}
          >
            Cancel booking
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

// ---------- Setup ----------

export function BookingSettingsForm({
  initial,
  timeZones,
}: {
  initial: Record<keyof SettingsInput, string | boolean>
  timeZones: string[]
}) {
  const { pending, submit, errors, formError } = useBookingAction()
  const [saved, setSaved] = useState(false)
  return (
    <form
      noValidate
      className="grid gap-4 sm:grid-cols-2"
      onChange={() => setSaved(false)}
      onSubmit={(e) => {
        e.preventDefault()
        const v = Object.fromEntries(new FormData(e.currentTarget)) as unknown as SettingsInput
        submit(
          () => saveSettingsAction(v),
          () => setSaved(true),
        )
      }}
    >
      <Choice
        label="Time zone"
        name="timeZone"
        defaultValue={String(initial.timeZone)}
        error={errors.timeZone}
        className="sm:col-span-2"
      >
        {timeZones.map((tz) => (
          <option key={tz}>{tz}</option>
        ))}
      </Choice>
      <Choice
        label="Slots every"
        name="slotMinutes"
        defaultValue={String(initial.slotMinutes)}
        error={errors.slotMinutes}
      >
        {SLOT_STEPS.map((m) => (
          <option key={m} value={m}>
            {m} minutes
          </option>
        ))}
      </Choice>
      <Input
        label="Book at least (minutes ahead)"
        name="minNoticeMinutes"
        type="number"
        min={0}
        defaultValue={String(initial.minNoticeMinutes)}
        error={errors.minNoticeMinutes}
      />
      <Input
        label="Book up to (days ahead)"
        name="maxDaysAhead"
        type="number"
        min={1}
        defaultValue={String(initial.maxDaysAhead)}
        error={errors.maxDaysAhead}
      />
      <Input
        label="Customers can cancel until (minutes before)"
        name="cancelNoticeMinutes"
        type="number"
        min={0}
        defaultValue={String(initial.cancelNoticeMinutes)}
        error={errors.cancelNoticeMinutes}
      />
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input
          type="checkbox"
          name="publicEnabled"
          defaultChecked={initial.publicEnabled === true}
        />{" "}
        Take bookings online
      </label>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input
          type="checkbox"
          name="requireApproval"
          defaultChecked={initial.requireApproval === true}
        />{" "}
        Approve online bookings before they're confirmed
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button disabled={pending}>{pending ? "Saving…" : "Save settings"}</Button>
        {saved && <span className="text-sm text-success">Saved</span>}
        <ErrorText>{formError}</ErrorText>
      </div>
    </form>
  )
}

export function PublicLink({ url, enabled }: { url: string; enabled: boolean }) {
  const router = useRouter()
  const [copied, setCopied] = useState(false)
  const [pending, start] = useTransition()
  return (
    <div className="grid gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <code
          className={cn(
            "min-w-0 flex-1 truncate rounded-md border bg-muted px-3 py-2 text-xs",
            !enabled && "opacity-50",
          )}
        >
          {url}
        </code>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Copy link"
          onClick={async () => {
            await navigator.clipboard.writeText(url)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>{enabled ? "Anyone with this link can book." : "Online booking is off."}</span>
        <button
          type="button"
          disabled={pending}
          className="underline hover:text-foreground"
          onClick={() => {
            if (!confirm("Make a new link? The current one stops working.")) return
            start(async () => {
              await rotateLinkAction()
              router.refresh()
            })
          }}
        >
          Make a new link
        </button>
      </div>
    </div>
  )
}

type ServiceRow = {
  id: string
  name: string
  description: string | null
  durationMinutes: number
  bufferMinutes: number
  priceCents: number
  currency: string
  resourceIds: string[]
  status: string
}

export function ServiceEditor({
  service,
  resources,
}: {
  service?: ServiceRow
  resources: Option[]
}) {
  const [open, setOpen] = useState(false)
  const { pending, submit, errors, formError, reset } = useBookingAction()
  const router = useRouter()
  const [busy, start] = useTransition()
  if (!open)
    return service ? (
      <div className="flex gap-1">
        <Button variant="quiet" size="sm" onClick={() => setOpen(true)}>
          Edit
        </Button>
        <Button
          variant="quiet"
          size="sm"
          disabled={busy}
          onClick={() =>
            start(async () => {
              await setServiceStatusAction(service.id, service.status === "active")
              router.refresh()
            })
          }
        >
          {service.status === "active" ? "Archive" : "Restore"}
        </Button>
      </div>
    ) : (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Plus /> Add service
      </Button>
    )
  return (
    <form
      noValidate
      className="grid w-full gap-3 rounded-lg border p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        const v = {
          ...Object.fromEntries(f),
          resourceIds: f.getAll("resourceIds").map(String),
        } as unknown as ServiceInput
        submit(
          () => saveServiceAction(service?.id ?? null, v),
          () => setOpen(false),
        )
      }}
    >
      <Input
        label="Name"
        name="name"
        defaultValue={service?.name}
        maxLength={120}
        error={errors.name}
        autoFocus
        className="sm:col-span-2"
      />
      <Input
        label="Length (minutes)"
        name="durationMinutes"
        type="number"
        min={5}
        defaultValue={service?.durationMinutes ?? 60}
        error={errors.durationMinutes}
      />
      <Input
        label="Gap after (minutes)"
        name="bufferMinutes"
        type="number"
        min={0}
        defaultValue={service?.bufferMinutes ?? 0}
        error={errors.bufferMinutes}
        hint="Clean-up or travel time."
      />
      <Input
        label="Price"
        name="price"
        inputMode="decimal"
        defaultValue={service ? (service.priceCents / 100).toFixed(2) : ""}
        error={errors.price}
      />
      <Choice label="Currency" name="currency" defaultValue={service?.currency ?? "USD"}>
        {CURRENCIES.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </Choice>
      <fieldset className="grid gap-1.5 text-sm sm:col-span-2">
        <legend className="mb-1 font-medium">Who does it</legend>
        <p className="text-xs text-muted-foreground">Leave all unticked for everyone.</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {resources.map((r) => (
            <label key={r.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                name="resourceIds"
                value={r.id}
                defaultChecked={service?.resourceIds.includes(r.id)}
              />
              {r.name}
            </label>
          ))}
        </div>
        {errors.resourceIds && <span className="text-xs text-danger">{errors.resourceIds}</span>}
      </fieldset>
      <Labeled label="Description" error={errors.description} className="sm:col-span-2">
        {(fid, d) => (
          <textarea
            id={fid}
            name="description"
            rows={2}
            maxLength={1000}
            defaultValue={service?.description ?? ""}
            aria-describedby={d}
            className={cn(control, "py-2")}
          />
        )}
      </Labeled>
      <ErrorText>{formError}</ErrorText>
      <div className="flex gap-2 sm:col-span-2">
        <Button size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="quiet"
          onClick={() => {
            reset()
            setOpen(false)
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}

type HourRow = { weekday: number; startMinute: number; endMinute: number }

/** Name, linked team member and weekly hours for one person or room. */
export function ResourceEditor({
  resource,
  members,
}: {
  resource?: { id: string; name: string; userId: string | null; status: string; hours: HourRow[] }
  members: Option[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const save = useBookingAction()
  const hoursSave = useBookingAction()
  const [rows, setRows] = useState(
    (resource?.hours ?? []).map((h) => ({
      weekday: h.weekday,
      start: formatClock(h.startMinute),
      end: formatClock(h.endMinute),
    })),
  )
  const [busy, start] = useTransition()
  const [savedHours, setSavedHours] = useState(false)

  if (!resource && !open)
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Plus /> Add person or room
      </Button>
    )

  return (
    <div className="grid gap-3">
      {(open || !resource) && (
        <form
          noValidate
          className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            save.submit(
              () =>
                saveResourceAction(resource?.id ?? null, {
                  name: String(f.get("name") ?? ""),
                  userId: String(f.get("userId") ?? ""),
                }),
              () => setOpen(false),
            )
          }}
        >
          <Input
            label="Name"
            name="name"
            defaultValue={resource?.name}
            maxLength={80}
            error={save.errors.name}
            autoFocus
          />
          <Choice
            label="Team member"
            name="userId"
            defaultValue={resource?.userId ?? ""}
            error={save.errors.userId}
          >
            <option value="">Not a person (room, equipment)</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Choice>
          <ErrorText>{save.formError}</ErrorText>
          <div className="flex gap-2 sm:col-span-2">
            <Button size="sm" disabled={save.pending}>
              Save
            </Button>
            <Button type="button" size="sm" variant="quiet" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {resource && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p
              className={cn("font-medium", resource.status !== "active" && "text-muted-foreground")}
            >
              {resource.name}
              {resource.status !== "active" && (
                <span className="ml-2 text-xs font-normal">(archived)</span>
              )}
            </p>
            <div className="flex gap-1">
              <Button variant="quiet" size="sm" onClick={() => setOpen(true)}>
                Edit
              </Button>
              <Button
                variant="quiet"
                size="sm"
                disabled={busy}
                onClick={() =>
                  start(async () => {
                    await setResourceStatusAction(resource.id, resource.status === "active")
                    router.refresh()
                  })
                }
              >
                {resource.status === "active" ? "Archive" : "Restore"}
              </Button>
            </div>
          </div>
          <div className="grid gap-1.5">
            {WEEKDAY_LABELS.map((label, wd) => {
              const dayRows = rows.map((r, i) => ({ ...r, i })).filter((r) => r.weekday === wd)
              return (
                <div key={label} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="w-24 text-muted-foreground">{label}</span>
                  {dayRows.length === 0 && (
                    <span className="text-xs text-muted-foreground">Closed</span>
                  )}
                  {dayRows.map((r) => (
                    <span key={r.i} className="flex items-center gap-1">
                      <input
                        type="time"
                        aria-label={`${label} start`}
                        value={r.start}
                        onChange={(e) =>
                          setRows((rs) =>
                            rs.map((x, j) => (j === r.i ? { ...x, start: e.target.value } : x)),
                          )
                        }
                        className={cn(control, "h-8 w-28")}
                      />
                      –
                      <input
                        type="time"
                        aria-label={`${label} end`}
                        value={r.end}
                        onChange={(e) =>
                          setRows((rs) =>
                            rs.map((x, j) => (j === r.i ? { ...x, end: e.target.value } : x)),
                          )
                        }
                        className={cn(control, "h-8 w-28")}
                      />
                      <button
                        type="button"
                        aria-label={`Remove ${label} hours`}
                        onClick={() => setRows((rs) => rs.filter((_, j) => j !== r.i))}
                        className="rounded p-1 text-muted-foreground hover:text-danger"
                      >
                        <X className="size-3.5" />
                      </button>
                    </span>
                  ))}
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline hover:text-foreground"
                    onClick={() =>
                      setRows((rs) => [...rs, { weekday: wd, start: "09:00", end: "17:00" }])
                    }
                  >
                    add hours
                  </button>
                </div>
              )
            })}
          </div>
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              variant="ghost"
              disabled={hoursSave.pending}
              onClick={() =>
                hoursSave.submit(
                  () => setHoursAction(resource.id, rows),
                  () => setSavedHours(true),
                )
              }
            >
              Save hours
            </Button>
            {savedHours && hoursSave.ok && <span className="text-xs text-success">Saved</span>}
            {Object.values(hoursSave.errors)[0] && (
              <span className="text-xs text-danger">{Object.values(hoursSave.errors)[0]}</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export function TimeOffForm({ resources }: { resources: Option[] }) {
  const { pending, submit, errors, formError } = useBookingAction()
  const [key, setKey] = useState(0)
  return (
    <form
      key={key}
      noValidate
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault()
        const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
        submit(
          () =>
            addTimeOffAction({
              resourceId: f.resourceId ?? "",
              startsAt: f.startsAt ?? "",
              endsAt: f.endsAt ?? "",
              reason: f.reason,
            }),
          () => setKey((k) => k + 1),
        )
      }}
    >
      <Choice label="Who" name="resourceId" error={errors.resourceId}>
        {resources.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </Choice>
      <Input
        label="Reason"
        name="reason"
        maxLength={200}
        placeholder="Holiday, training…"
        error={errors.reason}
      />
      <Input label="From" name="startsAt" type="datetime-local" error={errors.startsAt} />
      <Input label="Until" name="endsAt" type="datetime-local" error={errors.endsAt} />
      <ErrorText>{formError}</ErrorText>
      <div className="sm:col-span-2">
        <Button size="sm" variant="ghost" disabled={pending}>
          Add time off
        </Button>
      </div>
    </form>
  )
}

export function DeleteTimeOffButton({ id }: { id: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <button
      type="button"
      aria-label="Remove time off"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await deleteTimeOffAction(id)
          router.refresh()
        })
      }
      className="rounded p-1 text-muted-foreground hover:text-danger"
    >
      <X className="size-3.5" />
    </button>
  )
}
