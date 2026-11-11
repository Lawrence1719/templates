"use client"

import {
  CURRENCIES,
  formatMoney,
  formatQuantity,
  parseQuantity,
  refundAmount,
  TENDER_LABELS,
  TENDERS,
} from "@templates/pos/definitions"
import { Button } from "@templates/ui/button"
import { ErrorText } from "@templates/ui/form"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import {
  type PosResult,
  refundAction,
  savePosSettingsAction,
  saveRegisterAction,
  setRegisterStatusAction,
} from "@/app/actions/pos"
import { Choice, Input } from "@/components/fields"

type Option = { id: string; name: string }

function useAction() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [result, setResult] = useState<PosResult | null>(null)
  const submit = (fn: () => Promise<PosResult>, onOk?: (r: PosResult & { ok: true }) => void) =>
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

// ---------- Refunds ----------

type RefundLine = {
  id: string
  description: string
  unit: string | null
  quantityMilli: number
  totalCents: number
  refundedQtyMilli: number
  refundedCents: number
  productId: string | null
}

/** Pick what's coming back; the amount is worked out the same way the server will. */
export function RefundForm({
  saleId,
  lines,
  currency,
  registers,
  defaultTender,
  defaultRegisterId,
}: {
  saleId: string
  lines: RefundLine[]
  currency: string
  registers: Option[]
  defaultTender: string
  /** The register the sale was rung up on, when it's still active. */
  defaultRegisterId?: string
}) {
  const { pending, submit, errors, formError, reset } = useAction()
  const open = lines.filter((l) => l.quantityMilli > l.refundedQtyMilli)
  const [qty, setQty] = useState<Record<string, string>>({})
  const [shown, setShown] = useState(false)
  // The server's `lines.<n>` errors point into the list that was sent.
  const [sent, setSent] = useState<string[]>([])
  const picked = open
    .map((l) => ({ l, q: parseQuantity(qty[l.id] ?? "") }))
    .filter((x): x is { l: RefundLine; q: number } => x.q !== null)
  const amount = picked.reduce(
    (s, { l, q }) => s + refundAmount(l, Math.min(q, l.quantityMilli - l.refundedQtyMilli)),
    0,
  )
  const hasProducts = picked.some(({ l }) => l.productId)

  if (!open.length) return null
  if (!shown)
    return (
      <Button variant="ghost" onClick={() => setShown(true)}>
        Refund items
      </Button>
    )

  return (
    <form
      noValidate
      className="grid gap-4 rounded-xl border p-5"
      onSubmit={(e) => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        const chosen = open
          .map((l) => ({ lineId: l.id, quantity: (qty[l.id] ?? "").trim() }))
          .filter((x) => x.quantity && x.quantity !== "0")
        setSent(chosen.map((c) => c.lineId))
        submit(
          () =>
            refundAction(saleId, {
              registerId: String(f.get("registerId") ?? ""),
              tender: String(f.get("tender") ?? "") as (typeof TENDERS)[number],
              reason: String(f.get("reason") ?? ""),
              restock: f.get("restock") === "on",
              lines: chosen,
            }),
          () => {
            setQty({})
            setShown(false)
            reset()
          },
        )
      }}
    >
      <h2 className="font-semibold">Refund</h2>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="pb-2 font-medium">Item</th>
            <th className="pb-2 text-right font-medium">Can refund</th>
            <th className="w-28 pb-2 text-right font-medium">Quantity</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {open.map((l) => {
            const left = l.quantityMilli - l.refundedQtyMilli
            const err = Object.entries(errors).find(
              ([k]) => k.startsWith("lines.") && sent[Number(k.split(".")[1])] === l.id,
            )?.[1]
            return (
              <tr key={l.id}>
                <td className="py-2">{l.description}</td>
                <td className="py-2 text-right tabular-nums text-muted-foreground">
                  {formatQuantity(left)}
                  {l.unit ? ` ${l.unit}` : ""}
                </td>
                <td className="py-2 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <input
                      aria-label={`Quantity of ${l.description} to refund`}
                      aria-invalid={!!err || undefined}
                      inputMode="decimal"
                      placeholder="0"
                      value={qty[l.id] ?? ""}
                      onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))}
                      className="h-8 w-16 rounded-md border bg-transparent px-2 text-right tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-danger"
                    />
                    <button
                      type="button"
                      className="text-xs text-muted-foreground underline"
                      onClick={() => setQty((q) => ({ ...q, [l.id]: String(left / 1000) }))}
                    >
                      All
                    </button>
                  </div>
                  {err && <p className="mt-1 text-xs text-danger">{err}</p>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="grid gap-3 sm:grid-cols-2">
        <Choice
          label="Money goes back as"
          name="tender"
          defaultValue={defaultTender}
          error={errors.tender}
        >
          {TENDERS.map((t) => (
            <option key={t} value={t}>
              {TENDER_LABELS[t]}
            </option>
          ))}
        </Choice>
        <Choice
          label="From register"
          name="registerId"
          defaultValue={
            registers.some((r) => r.id === defaultRegisterId) ? defaultRegisterId : registers[0]?.id
          }
          error={errors.registerId}
        >
          {registers.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Choice>
        <Input
          label="Reason"
          name="reason"
          maxLength={300}
          className="sm:col-span-2"
          error={errors.reason}
        />
      </div>
      {hasProducts && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="restock" defaultChecked className="size-4" />
          Put the items back in stock at that register's location
        </label>
      )}
      <ErrorText>{formError ?? errors.lines}</ErrorText>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm">
          Refund <span className="font-semibold tabular-nums">{formatMoney(amount, currency)}</span>
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={() => setShown(false)}>
            Cancel
          </Button>
          <Button disabled={pending || picked.length === 0}>
            {pending ? "Refunding…" : "Refund"}
          </Button>
        </div>
      </div>
    </form>
  )
}

// ---------- Setup ----------

export function PosSettingsForm({
  initial,
}: {
  initial: {
    receiptPrefix: string
    currency: string
    taxRate: string
    pricesIncludeTax: boolean
    maxDiscount: string
    timeZone: string
    receiptHeader: string
    receiptFooter: string
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
        const s = (k: string) => String(f.get(k) ?? "")
        submit(() =>
          savePosSettingsAction({
            receiptPrefix: s("receiptPrefix"),
            currency: s("currency") as (typeof CURRENCIES)[number],
            taxRate: s("taxRate"),
            pricesIncludeTax: f.get("pricesIncludeTax") === "on",
            maxDiscount: s("maxDiscount"),
            timeZone: s("timeZone"),
            receiptHeader: s("receiptHeader"),
            receiptFooter: s("receiptFooter"),
          }),
        )
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Choice
          label="Currency"
          name="currency"
          defaultValue={initial.currency}
          error={errors.currency}
        >
          {CURRENCIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Choice>
        <Input
          label="Time zone"
          name="timeZone"
          defaultValue={initial.timeZone}
          hint="Used to group sales by day, e.g. Asia/Manila"
          error={errors.timeZone}
        />
        <Input
          label="Tax rate (%)"
          name="taxRate"
          inputMode="decimal"
          defaultValue={initial.taxRate}
          error={errors.taxRate}
        />
        <Input
          label="Largest discount without a manager (%)"
          name="maxDiscount"
          inputMode="decimal"
          defaultValue={initial.maxDiscount}
          error={errors.maxDiscount}
        />
        <Input
          label="Receipt number prefix"
          name="receiptPrefix"
          defaultValue={initial.receiptPrefix}
          maxLength={10}
          error={errors.receiptPrefix}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="pricesIncludeTax"
          defaultChecked={initial.pricesIncludeTax}
          className="size-4"
        />
        Shelf prices already include tax
      </label>
      <Input
        label="Receipt header"
        name="receiptHeader"
        defaultValue={initial.receiptHeader}
        maxLength={300}
        hint="Address, phone or tax ID printed at the top"
        error={errors.receiptHeader}
      />
      <Input
        label="Receipt footer"
        name="receiptFooter"
        defaultValue={initial.receiptFooter}
        maxLength={300}
        hint="Returns policy or a thank-you line"
        error={errors.receiptFooter}
      />
      <ErrorText>{formError}</ErrorText>
      <div className="flex items-center gap-3">
        <Button disabled={pending}>{pending ? "Saving…" : "Save settings"}</Button>
        {ok && <span className="text-sm text-success">Saved</span>}
      </div>
    </form>
  )
}

export function RegisterForm({
  id,
  name,
  locationId,
  locations,
  onDone,
}: {
  id: string | null
  name?: string
  locationId?: string
  locations: Option[]
  onDone?: () => void
}) {
  const { pending, submit, errors, formError } = useAction()
  return (
    <form
      noValidate
      className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault()
        const form = e.currentTarget
        const f = new FormData(form)
        submit(
          () =>
            saveRegisterAction(id, {
              name: String(f.get("name") ?? ""),
              locationId: String(f.get("locationId") ?? ""),
            }),
          () => {
            if (!id) form.reset()
            onDone?.()
          },
        )
      }}
    >
      <Input
        label="Register name"
        name="name"
        defaultValue={name}
        maxLength={60}
        error={errors.name}
      />
      <Choice
        label="Sells stock from"
        name="locationId"
        defaultValue={locationId ?? locations[0]?.id}
        error={errors.locationId}
      >
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </Choice>
      <Button disabled={pending || locations.length === 0}>
        {pending ? "Saving…" : id ? "Save" : "Add register"}
      </Button>
      {formError && (
        <div className="sm:col-span-3">
          <ErrorText>{formError}</ErrorText>
        </div>
      )}
    </form>
  )
}

export function RegisterRow({
  register,
  locations,
}: {
  register: {
    id: string
    name: string
    status: string
    locationId: string
    locationName: string
    shiftId: string | null
  }
  locations: Option[]
}) {
  const [editing, setEditing] = useState(false)
  const { pending, submit, formError } = useAction()
  const archived = register.status === "archived"
  return (
    <li className="grid gap-3 py-3">
      {editing ? (
        <RegisterForm
          id={register.id}
          name={register.name}
          locationId={register.locationId}
          locations={locations}
          onDone={() => setEditing(false)}
        />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-medium">
              {register.name}
              {archived && <span className="ml-2 text-xs text-muted-foreground">Archived</span>}
            </p>
            <p className="text-sm text-muted-foreground">
              {register.locationName}
              {register.shiftId ? " · shift open" : ""}
            </p>
          </div>
          <div className="flex gap-1.5">
            {!archived && (
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => submit(() => setRegisterStatusAction(register.id, !archived))}
            >
              {archived ? "Restore" : "Archive"}
            </Button>
          </div>
        </div>
      )}
      <ErrorText>{formError}</ErrorText>
    </li>
  )
}
