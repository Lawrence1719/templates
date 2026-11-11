"use client"

import {
  addDays,
  formatDayLabel,
  formatMoney,
  formatTime,
  today,
} from "@templates/bookings/definitions"
import { Button } from "@templates/ui/button"
import { cn } from "@templates/ui/cn"
import { ErrorText } from "@templates/ui/form"
import { useRouter } from "next/navigation"
import { useEffect, useState, useTransition } from "react"

import { bookOnlineAction, cancelByTokenAction } from "@/app/actions/bookings"
import { Input } from "@/components/fields"

type Service = {
  id: string
  name: string
  description: string | null
  durationMinutes: number
  priceCents: number
  currency: string
  resourceIds: string[]
}

/** Pick a service, a person (or anyone), a day and a time, then enter details. No account needed. */
export function PublicBooking({
  slug,
  timeZone,
  maxDaysAhead,
  services,
  resources,
}: {
  slug: string
  timeZone: string
  maxDaysAhead: number
  services: Service[]
  resources: { id: string; name: string }[]
}) {
  const router = useRouter()
  const first = today(timeZone)
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "")
  const svc = services.find((s) => s.id === serviceId)
  const people = resources.filter((r) => !svc?.resourceIds.length || svc.resourceIds.includes(r.id))
  const [resourceId, setResourceId] = useState("any")
  const [day, setDay] = useState(first)
  const [slots, setSlots] = useState<string[] | null>(null)
  const [startsAt, setStartsAt] = useState("")
  const [loading, setLoading] = useState(false)
  const [pending, start] = useTransition()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => {
    setStartsAt("")
    if (!serviceId || !day) return
    const q = new URLSearchParams({ service: serviceId, resource: resourceId, day })
    setLoading(true)
    fetch(`/book/${slug}/slots?${q}`)
      .then((r) => (r.ok ? r.json() : { slots: [] }))
      .then((d: { slots: string[] }) => setSlots(d.slots))
      .catch(() => setSlots([]))
      .finally(() => setLoading(false))
  }, [slug, serviceId, resourceId, day])

  if (done) return <p className="rounded-xl border p-6 text-sm">{done}</p>

  return (
    <form
      noValidate
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        const data = {
          serviceId,
          resourceId,
          startsAt,
          customerName: String(f.get("customerName") ?? ""),
          customerEmail: String(f.get("customerEmail") ?? ""),
          customerPhone: String(f.get("customerPhone") ?? ""),
          notes: String(f.get("notes") ?? ""),
        }
        start(async () => {
          setErrors({})
          setFormError(null)
          const r = await bookOnlineAction(slug, data, String(f.get("website") ?? ""))
          if (!r.ok) {
            setErrors(r.fieldErrors ?? {})
            setFormError(r.fieldErrors ? null : r.error)
            if (r.fieldErrors?.startsAt) {
              // Someone took it: drop that time from the list.
              setSlots((s) => s?.filter((x) => x !== startsAt) ?? null)
              setStartsAt("")
            }
            return
          }
          if (r.token) router.push(`/book/manage/${r.token}`)
          else setDone("Thanks! We'll be in touch.")
        })
      }}
    >
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">1. What would you like?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {services.map((s) => (
            <label
              key={s.id}
              className="flex cursor-pointer flex-col gap-0.5 rounded-lg border p-3 text-sm has-checked:border-foreground has-checked:bg-accent"
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="service"
                  checked={serviceId === s.id}
                  onChange={() => setServiceId(s.id)}
                />
                <span className="font-medium">{s.name}</span>
              </span>
              <span className="pl-5 text-xs text-muted-foreground">
                {s.durationMinutes} min
                {s.priceCents > 0 && ` · ${formatMoney(s.priceCents, s.currency)}`}
              </span>
              {s.description && (
                <span className="pl-5 text-xs text-muted-foreground">{s.description}</span>
              )}
            </label>
          ))}
        </div>
      </fieldset>

      {people.length > 1 && (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">2. With whom?</legend>
          <div className="flex flex-wrap gap-1.5">
            {[{ id: "any", name: "Anyone available" }, ...people].map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={resourceId === p.id}
                onClick={() => setResourceId(p.id)}
                className={cn(
                  "h-9 rounded-full border px-3 text-sm",
                  resourceId === p.id
                    ? "border-foreground bg-accent font-medium"
                    : "hover:bg-accent",
                )}
              >
                {p.name}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-medium">{people.length > 1 ? "3" : "2"}. When?</legend>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={day <= first}
            onClick={() => setDay(addDays(day, -1))}
            aria-label="Previous day"
          >
            ←
          </Button>
          <input
            type="date"
            aria-label="Day"
            value={day}
            min={first}
            max={addDays(first, maxDaysAhead)}
            onChange={(e) => e.target.value && setDay(e.target.value)}
            className="h-8 rounded-md border bg-transparent px-2 text-sm"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={day >= addDays(first, maxDaysAhead)}
            onClick={() => setDay(addDays(day, 1))}
            aria-label="Next day"
          >
            →
          </Button>
          <span className="text-sm text-muted-foreground">{formatDayLabel(day)}</span>
        </div>
        {loading ? (
          <p className="text-sm text-muted-foreground">Finding times…</p>
        ) : slots && slots.length === 0 ? (
          <p className="text-sm text-muted-foreground">No times free that day. Try another.</p>
        ) : (
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
            {slots?.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={startsAt === s}
                onClick={() => setStartsAt(s)}
                className={cn(
                  "h-10 rounded-md border text-sm tabular-nums",
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
        <p className="text-xs text-muted-foreground">Times are in {timeZone}.</p>
        {errors.startsAt && (
          <span className="text-xs text-danger">That time was just taken. Pick another.</span>
        )}
      </fieldset>

      {startsAt && (
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-1 text-sm font-medium">Your details</legend>
          <Input
            label="Name"
            name="customerName"
            autoComplete="name"
            required
            maxLength={120}
            error={errors.customerName}
          />
          <Input
            label="Email"
            name="customerEmail"
            type="email"
            autoComplete="email"
            required
            error={errors.customerEmail}
          />
          <Input
            label="Phone"
            name="customerPhone"
            type="tel"
            autoComplete="tel"
            error={errors.customerPhone}
          />
          <Input
            label="Anything we should know?"
            name="notes"
            maxLength={1000}
            error={errors.notes}
          />
          {/* Hidden from people, filled in by bots. */}
          <div aria-hidden className="absolute -left-[9999px]">
            <label>
              Website <input name="website" tabIndex={-1} autoComplete="off" />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button disabled={pending}>
              {pending ? "Booking…" : `Book ${formatTime(new Date(startsAt), timeZone)}`}
            </Button>
            <ErrorText>{formError}</ErrorText>
          </div>
        </fieldset>
      )}
    </form>
  )
}

export function CancelBookingButton({ token }: { token: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="grid gap-2">
      <Button
        variant="danger"
        disabled={pending}
        onClick={() => {
          const reason = prompt("Cancel this booking? You can tell us why (optional).")
          if (reason === null) return
          start(async () => {
            const r = await cancelByTokenAction(token, reason)
            if (!r.ok) setError(r.error)
            router.refresh()
          })
        }}
      >
        Cancel booking
      </Button>
      <ErrorText>{error}</ErrorText>
    </div>
  )
}
