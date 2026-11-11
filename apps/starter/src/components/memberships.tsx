"use client"

import {
  CURRENCIES,
  formatMoney,
  formatPeriod,
  formatVisits,
  type MembershipState,
  PAID_VIA,
  PAID_VIA_LABELS,
  PERIOD_UNITS,
  STATE_LABELS,
} from "@templates/memberships/definitions"
import { Button } from "@templates/ui/button"
import { cn } from "@templates/ui/cn"
import { ErrorText } from "@templates/ui/form"
import { CheckCircle2, ScanLine, XCircle } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState, useTransition } from "react"

import {
  cancelMembershipAction,
  checkInAction,
  emailCardAction,
  findMembersAction,
  type MembershipResult,
  pauseMembershipAction,
  renewMembershipAction,
  replaceCardAction,
  resumeMembershipAction,
  saveMembershipSettingsAction,
  savePlanAction,
  setAutoRenewAction,
  setPlanStatusAction,
  startMembershipAction,
  voidCheckInAction,
} from "@/app/actions/memberships"
import { Choice, control, Input } from "@/components/fields"

type CheckInResult = Awaited<ReturnType<typeof checkInAction>>

function useAction() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [result, setResult] = useState<MembershipResult | null>(null)
  const submit = (
    fn: () => Promise<MembershipResult>,
    onOk?: (r: MembershipResult & { ok: true }) => void,
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
  return { pending, submit, errors, formError, result, reset: () => setResult(null) }
}

const str = (f: FormData, k: string) => String(f.get(k) ?? "")
const longDay = (d: string) =>
  new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${d}T00:00:00Z`),
  )

export function StateBadge({ state }: { state: MembershipState }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
        state === "active" && "bg-success/15 text-success",
        state === "expiring" && "bg-warning/15 text-warning",
        (state === "expired" || state === "cancelled") && "bg-muted text-muted-foreground",
        (state === "paused" || state === "upcoming") && "bg-accent text-foreground",
      )}
    >
      {STATE_LABELS[state]}
    </span>
  )
}

// ---------- Check-in desk ----------

/**
 * Scan or type a card code and press Enter, or search by name. The field
 * clears and refocuses after every check-in, so a scanner can keep going.
 */
export function CheckInDesk() {
  const router = useRouter()
  const [code, setCode] = useState("")
  const [result, setResult] = useState<CheckInResult | null>(null)
  const [matches, setMatches] = useState<Awaited<ReturnType<typeof findMembersAction>>>([])
  const [pending, start] = useTransition()
  const input = useRef<HTMLInputElement>(null)

  // Looks like a card code (long, no spaces)? Don't search names for it.
  const looksLikeCode = /^[A-Za-z0-9-]{20,}$/.test(code.trim())
  useEffect(() => {
    const q = code.trim()
    if (q.length < 2 || looksLikeCode) {
      setMatches([])
      return
    }
    const t = setTimeout(() => findMembersAction(q).then(setMatches), 250)
    return () => clearTimeout(t)
  }, [code, looksLikeCode])

  const go = (by: { code: string } | { membershipId: string }) =>
    start(async () => {
      const r = await checkInAction(by)
      setResult(r)
      setCode("")
      setMatches([])
      if (r.ok) router.refresh()
      input.current?.focus()
    })

  return (
    <div className="grid gap-4">
      <form
        className="relative"
        onSubmit={(e) => {
          e.preventDefault()
          const q = code.trim()
          if (!q) return
          if (looksLikeCode) go({ code: q })
          else if (matches.length === 1 && matches[0]) go({ membershipId: matches[0].id })
        }}
      >
        <ScanLine className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={input}
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-label="Scan a card or search by name"
          placeholder="Scan a card, type its code, or search by name…"
          autoComplete="off"
          className={cn(control, "h-14 pl-11 text-lg")}
        />
      </form>

      {matches.length > 0 && (
        <ul className="grid divide-y rounded-xl border text-sm">
          {matches.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span>
                <span className="font-medium">{m.customerName}</span>
                <span className="text-muted-foreground"> · {m.planName}</span>{" "}
                <StateBadge state={m.state} />
              </span>
              <Button size="sm" disabled={pending} onClick={() => go({ membershipId: m.id })}>
                Check in
              </Button>
            </li>
          ))}
        </ul>
      )}

      {result && (
        <div
          role="status"
          aria-live="assertive"
          className={cn(
            "flex items-start gap-4 rounded-xl border-2 p-5 [&_svg]:size-8 [&_svg]:shrink-0",
            result.ok ? "border-success bg-success/10" : "border-danger bg-danger/10",
          )}
        >
          {result.ok ? (
            <CheckCircle2 className="text-success" />
          ) : (
            <XCircle className="text-danger" />
          )}
          <div className="grid gap-1">
            <p className="text-xl font-semibold">
              {result.ok
                ? `Welcome, ${result.memberName}`
                : result.memberName
                  ? `${result.memberName}: not checked in`
                  : "Not checked in"}
            </p>
            <p className="text-sm">
              {result.ok
                ? `${result.planName} · until ${longDay(result.periodEnd)}${result.visitsLeft !== null ? ` · ${result.visitsLeft} ${result.visitsLeft === 1 ? "visit" : "visits"} left` : ""}`
                : result.reason}
            </p>
            {result.membershipId && (
              <Link href={`/memberships/${result.membershipId}`} className="text-sm underline">
                Open membership
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function VoidCheckInButton({ id }: { id: string }) {
  const { pending, submit, formError } = useAction()
  return (
    <span className="inline-grid justify-items-end">
      <Button
        variant="quiet"
        size="sm"
        disabled={pending}
        onClick={() => submit(() => voidCheckInAction(id))}
      >
        Undo
      </Button>
      <ErrorText>{formError}</ErrorText>
    </span>
  )
}

// ---------- Signing up ----------

export function StartMembershipForm({
  customers,
  plans,
  defaultDay,
  defaultCustomer,
}: {
  customers: { id: string; name: string; email: string | null }[]
  plans: {
    id: string
    name: string
    priceCents: number
    currency: string
    periodUnit: (typeof PERIOD_UNITS)[number]
    periodCount: number
    visitLimit: number | null
  }[]
  defaultDay: string
  defaultCustomer?: string
}) {
  const router = useRouter()
  const { pending, submit, errors, formError } = useAction()
  const [planId, setPlanId] = useState(plans[0]?.id ?? "")
  const plan = plans.find((p) => p.id === planId)
  if (plans.length === 0) return <p className="text-sm text-muted-foreground">Add a plan first.</p>
  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        submit(
          () =>
            startMembershipAction({
              customerId: str(f, "customerId"),
              planId,
              startDay: str(f, "startDay"),
              paidVia: str(f, "paidVia") as (typeof PAID_VIA)[number],
              autoRenew: f.get("autoRenew") === "on",
            }),
          (r) => router.push(`/memberships/${r.id}`),
        )
      }}
    >
      <Choice
        label="Customer"
        name="customerId"
        defaultValue={defaultCustomer ?? ""}
        error={errors.customerId}
      >
        <option value="" disabled>
          Choose…
        </option>
        {customers.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.email ? ` (${c.email})` : ""}
          </option>
        ))}
      </Choice>
      <p className="-mt-2 text-xs text-muted-foreground">
        New here?{" "}
        <Link href="/customers/new" className="underline">
          Add them as a customer
        </Link>{" "}
        first.
      </p>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Plan</legend>
        {plans.map((p) => (
          <label
            key={p.id}
            className={cn(
              "flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm",
              planId === p.id && "border-foreground bg-accent",
            )}
          >
            <span className="flex items-center gap-3">
              <input
                type="radio"
                name="plan"
                value={p.id}
                checked={planId === p.id}
                onChange={() => setPlanId(p.id)}
              />
              <span>
                <span className="font-medium">{p.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {formatVisits(p.visitLimit)}
                </span>
              </span>
            </span>
            <span className="tabular-nums">
              {formatMoney(p.priceCents, p.currency)}{" "}
              <span className="text-muted-foreground">{formatPeriod(p)}</span>
            </span>
          </label>
        ))}
        <ErrorText>{errors.planId}</ErrorText>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Starts"
          name="startDay"
          type="date"
          defaultValue={defaultDay}
          error={errors.startDay}
        />
        <Choice label="Paid" name="paidVia" defaultValue="cash" error={errors.paidVia}>
          {PAID_VIA.map((p) => (
            <option key={p} value={p}>
              {PAID_VIA_LABELS[p]}
            </option>
          ))}
        </Choice>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="autoRenew" className="size-4" /> Renew automatically with an
        invoice when it ends
      </label>
      <ErrorText>{formError}</ErrorText>
      <Button disabled={pending}>
        {pending
          ? "Saving…"
          : `Start membership${plan ? ` · ${formatMoney(plan.priceCents, plan.currency)}` : ""}`}
      </Button>
    </form>
  )
}

// ---------- One membership ----------

export function MembershipActions({
  id,
  status,
  periodEnd,
  autoRenew,
  hasEmail,
  canManage,
  price,
}: {
  id: string
  status: "active" | "paused" | "cancelled"
  periodEnd: string
  autoRenew: boolean
  hasEmail: boolean
  canManage: boolean
  price: string
}) {
  const a = useAction()
  const [renewing, setRenewing] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const emailed = a.result?.ok ? a.result.emailed : undefined
  if (status === "cancelled") return null
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {status === "active" && (
          <Button onClick={() => setRenewing((v) => !v)}>Renew · {price}</Button>
        )}
        {status === "active" ? (
          <Button
            variant="ghost"
            disabled={a.pending}
            onClick={() => a.submit(() => pauseMembershipAction(id))}
          >
            Pause
          </Button>
        ) : (
          <Button disabled={a.pending} onClick={() => a.submit(() => resumeMembershipAction(id))}>
            Resume
          </Button>
        )}
        <Button
          variant="ghost"
          disabled={a.pending}
          onClick={() => a.submit(() => setAutoRenewAction(id, !autoRenew))}
        >
          Auto-renew: {autoRenew ? "on" : "off"}
        </Button>
        {hasEmail && (
          <Button
            variant="ghost"
            disabled={a.pending}
            onClick={() => a.submit(() => emailCardAction(id))}
          >
            Email card link
          </Button>
        )}
        <Button
          variant="ghost"
          disabled={a.pending}
          onClick={() => {
            if (confirm("Replace the card? The old code will stop working."))
              a.submit(() => replaceCardAction(id))
          }}
        >
          Replace card
        </Button>
        {canManage && (
          <Button variant="danger" onClick={() => setCancelling((v) => !v)}>
            Cancel membership
          </Button>
        )}
      </div>
      {emailed === true && <p className="text-sm text-success">Card link sent.</p>}
      {emailed === false && <p className="text-sm text-danger">Couldn't send the email.</p>}
      <ErrorText>{a.formError}</ErrorText>
      {renewing && <RenewForm id={id} periodEnd={periodEnd} onDone={() => setRenewing(false)} />}
      {cancelling && <CancelForm id={id} onDone={() => setCancelling(false)} />}
    </div>
  )
}

function RenewForm({
  id,
  periodEnd,
  onDone,
}: {
  id: string
  periodEnd: string
  onDone: () => void
}) {
  const { pending, submit, errors, formError } = useAction()
  return (
    <form
      noValidate
      className="flex flex-wrap items-end gap-3 rounded-xl border p-4"
      onSubmit={(e) => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        submit(
          () =>
            renewMembershipAction(id, {
              paidVia: str(f, "paidVia") as (typeof PAID_VIA)[number],
              expectedPeriodEnd: periodEnd,
            }),
          onDone,
        )
      }}
    >
      <Choice
        label="Paid"
        name="paidVia"
        defaultValue="cash"
        error={errors.paidVia}
        className="min-w-48"
      >
        {PAID_VIA.map((p) => (
          <option key={p} value={p}>
            {PAID_VIA_LABELS[p]}
          </option>
        ))}
      </Choice>
      <Button disabled={pending}>{pending ? "Renewing…" : "Confirm renewal"}</Button>
      <div className="w-full">
        <ErrorText>{formError ?? errors.expectedPeriodEnd}</ErrorText>
      </div>
    </form>
  )
}

function CancelForm({ id, onDone }: { id: string; onDone: () => void }) {
  const { pending, submit, errors, formError } = useAction()
  return (
    <form
      noValidate
      className="flex flex-wrap items-end gap-3 rounded-xl border border-danger/40 p-4"
      onSubmit={(e) => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        submit(() => cancelMembershipAction(id, str(f, "reason")), onDone)
      }}
    >
      <Input
        label="Why is it cancelled?"
        name="reason"
        maxLength={300}
        className="min-w-64 flex-1"
        error={errors.reason}
      />
      <Button variant="danger" disabled={pending}>
        {pending ? "Cancelling…" : "Cancel for good"}
      </Button>
      <div className="w-full">
        <ErrorText>{formError}</ErrorText>
      </div>
    </form>
  )
}

export function CheckInHereButton({ id }: { id: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [result, setResult] = useState<CheckInResult | null>(null)
  return (
    <span className="inline-grid gap-1">
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await checkInAction({ membershipId: id })
            setResult(r)
            if (r.ok) router.refresh()
          })
        }
      >
        Check in now
      </Button>
      {result && (
        <span className={cn("text-sm", result.ok ? "text-success" : "text-danger")}>
          {result.ok ? "Checked in" : result.reason}
        </span>
      )}
    </span>
  )
}

// ---------- Plans and settings ----------

type PlanRow = {
  id: string
  name: string
  description: string | null
  priceCents: number
  currency: string
  periodUnit: (typeof PERIOD_UNITS)[number]
  periodCount: number
  visitLimit: number | null
  status: string
  members: number
}

export function PlanForm({ plan, onDone }: { plan?: PlanRow; onDone?: () => void }) {
  const { pending, submit, errors, formError } = useAction()
  return (
    <form
      noValidate
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault()
        const form = e.currentTarget
        const f = new FormData(form)
        submit(
          () =>
            savePlanAction(plan?.id ?? null, {
              name: str(f, "name"),
              description: str(f, "description"),
              price: str(f, "price"),
              currency: str(f, "currency") as (typeof CURRENCIES)[number],
              periodUnit: str(f, "periodUnit") as (typeof PERIOD_UNITS)[number],
              periodCount: str(f, "periodCount"),
              visitLimit: str(f, "visitLimit"),
            }),
          () => {
            if (!plan) form.reset()
            onDone?.()
          },
        )
      }}
    >
      <Input
        label="Plan name"
        name="name"
        defaultValue={plan?.name}
        maxLength={80}
        error={errors.name}
      />
      <div className="grid grid-cols-[1fr_6rem] gap-2">
        <Input
          label="Price"
          name="price"
          inputMode="decimal"
          defaultValue={plan ? (plan.priceCents / 100).toFixed(2) : ""}
          error={errors.price}
        />
        <Choice
          label="Currency"
          name="currency"
          defaultValue={plan?.currency ?? "USD"}
          error={errors.currency}
        >
          {CURRENCIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Choice>
      </div>
      <div className="grid grid-cols-[5rem_1fr] gap-2">
        <Input
          label="Every"
          name="periodCount"
          inputMode="numeric"
          defaultValue={String(plan?.periodCount ?? 1)}
          error={errors.periodCount}
        />
        <Choice
          label="Period"
          name="periodUnit"
          defaultValue={plan?.periodUnit ?? "month"}
          error={errors.periodUnit}
        >
          {PERIOD_UNITS.map((u) => (
            <option key={u} value={u}>
              {u}(s)
            </option>
          ))}
        </Choice>
      </div>
      <Input
        label="Visits per period"
        name="visitLimit"
        inputMode="numeric"
        placeholder="Blank = unlimited"
        defaultValue={plan?.visitLimit ? String(plan.visitLimit) : ""}
        error={errors.visitLimit}
      />
      <Input
        label="Description"
        name="description"
        maxLength={500}
        defaultValue={plan?.description ?? ""}
        className="sm:col-span-2"
        error={errors.description}
      />
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button variant={plan ? "primary" : "ghost"} disabled={pending}>
          {pending ? "Saving…" : plan ? "Save plan" : "Add plan"}
        </Button>
        {plan && onDone && (
          <Button type="button" variant="quiet" onClick={onDone}>
            Cancel
          </Button>
        )}
        {plan && (
          <span className="text-xs text-muted-foreground">
            Price changes apply from each member's next renewal.
          </span>
        )}
        <ErrorText>{formError}</ErrorText>
      </div>
    </form>
  )
}

export function PlanRowItem({ plan }: { plan: PlanRow }) {
  const [editing, setEditing] = useState(false)
  const { pending, submit, formError } = useAction()
  if (editing)
    return (
      <li className="py-4">
        <PlanForm plan={plan} onDone={() => setEditing(false)} />
      </li>
    )
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
      <span className={cn(plan.status === "archived" && "text-muted-foreground")}>
        <span className="font-medium">{plan.name}</span>
        {plan.status === "archived" && " (archived)"} ·{" "}
        {formatMoney(plan.priceCents, plan.currency)} {formatPeriod(plan)} ·{" "}
        {formatVisits(plan.visitLimit)}
        <span className="block text-xs text-muted-foreground">
          {plan.members} {plan.members === 1 ? "member" : "members"}
        </span>
      </span>
      <span className="flex gap-1.5">
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => submit(() => setPlanStatusAction(plan.id, plan.status === "active"))}
        >
          {plan.status === "active" ? "Archive" : "Restore"}
        </Button>
      </span>
      <ErrorText>{formError}</ErrorText>
    </li>
  )
}

export function MembershipSettingsForm({
  initial,
}: {
  initial: { timeZone: string; checkInCooldownMinutes: number; reminderDays: number }
}) {
  const { pending, submit, errors, formError, result } = useAction()
  return (
    <form
      noValidate
      className="grid gap-4 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        submit(() =>
          saveMembershipSettingsAction({
            timeZone: str(f, "timeZone"),
            checkInCooldownMinutes: str(f, "cooldown"),
            reminderDays: str(f, "reminderDays"),
          }),
        )
      }}
    >
      <Input
        label="Time zone"
        name="timeZone"
        defaultValue={initial.timeZone}
        error={errors.timeZone}
      />
      <Input
        label="Ignore repeat scans for (minutes)"
        name="cooldown"
        inputMode="numeric"
        defaultValue={String(initial.checkInCooldownMinutes)}
        error={errors.checkInCooldownMinutes}
      />
      <Input
        label="Renewal reminder (days before)"
        name="reminderDays"
        inputMode="numeric"
        defaultValue={String(initial.reminderDays)}
        hint="0 turns reminders off"
        error={errors.reminderDays}
      />
      <div className="flex items-center gap-3 sm:col-span-3">
        <Button disabled={pending}>{pending ? "Saving…" : "Save settings"}</Button>
        {result?.ok && <span className="text-sm text-success">Saved</span>}
        <ErrorText>{formError}</ErrorText>
      </div>
    </form>
  )
}
