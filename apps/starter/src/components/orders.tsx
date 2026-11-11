"use client"

import { parsePercent, parseQuantity, parseSignedMoney } from "@templates/invoicing/definitions"
import {
  CURRENCIES,
  computeTotals,
  formatMoney,
  type OrderInput,
} from "@templates/orders/definitions"
import { Button } from "@templates/ui/button"
import { cn } from "@templates/ui/cn"
import { ErrorText, Select } from "@templates/ui/form"
import { Plus, Trash2, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import {
  addOrderNoteAction,
  cancelOrderAction,
  confirmOrderAction,
  deleteDraftOrderAction,
  duplicateOrderAction,
  fulfillOrderAction,
  invoiceOrderAction,
  type OrderResult,
  saveOrderAction,
} from "@/app/actions/orders"
import { Choice, control, Input, Labeled } from "@/components/fields"

type Option = { id: string; name: string }
type ProductOption = { id: string; sku: string; name: string; unit: string; priceCents: number }
type LineDraft = {
  key: string
  productId: string
  description: string
  quantity: string
  unitPrice: string
  taxRate: string
}
export type OrderFormValues = {
  customerId: string
  orderDate: string
  requestedOn: string
  locationId: string
  currency: string
  shippingAddress: string
  notes: string
  lines: Omit<LineDraft, "key">[]
}

const newKey = () => Math.random().toString(36).slice(2)

function useOrderAction() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [result, setResult] = useState<OrderResult | null>(null)
  const submit = (fn: () => Promise<OrderResult>, onOk?: (r: OrderResult & { ok: true }) => void) =>
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
  return { pending, submit, errors, formError, setResult }
}

/** Order editor. Picking a product fills its name and price; totals match what gets stored. */
export function OrderEditor({
  id,
  initial,
  customers,
  products,
  locations,
  available,
  stockErrors,
}: {
  id: string | null
  initial: OrderFormValues
  customers: (Option & { address: string | null })[]
  products: ProductOption[]
  locations: Option[]
  /** On hand per line at the order's location, when saved. */
  available?: (string | null)[]
  stockErrors?: Record<string, string>
}) {
  const router = useRouter()
  const { pending, submit, errors: saveErrors, formError } = useOrderAction()
  const errors = { ...stockErrors, ...saveErrors }
  const [lines, setLines] = useState<LineDraft[]>(() =>
    (initial.lines.length
      ? initial.lines
      : [{ productId: "", description: "", quantity: "1", unitPrice: "", taxRate: "0" }]
    ).map((l) => ({ ...l, key: newKey() })),
  )
  const [currency, setCurrency] = useState(initial.currency)
  const [address, setAddress] = useState(initial.shippingAddress)
  const byId = new Map(products.map((p) => [p.id, p]))
  const preview = computeTotals(
    lines.map((l) => ({
      quantityMilli: parseQuantity(l.quantity || "1") ?? 0,
      unitPriceCents: parseSignedMoney(l.unitPrice || "0") ?? 0,
      taxRateBp: parsePercent(l.taxRate || "0") ?? 0,
    })),
  )
  const money = (c: number) => formatMoney(c, currency)
  const update = (key: string, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const err = (i: number, f?: string) => errors[f ? `lines.${i}.${f}` : `lines.${i}`]

  return (
    <form
      noValidate
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        const input = {
          customerId: String(f.get("customerId") ?? ""),
          orderDate: String(f.get("orderDate") ?? ""),
          requestedOn: String(f.get("requestedOn") ?? ""),
          locationId: String(f.get("locationId") ?? ""),
          currency,
          shippingAddress: address,
          notes: String(f.get("notes") ?? ""),
          lines: lines.map(({ key: _k, ...l }) => l),
        } as OrderInput // The server re-validates everything.
        submit(
          () => saveOrderAction(id, input),
          (r) => {
            if (!id && r.id) router.push(`/orders/${r.id}`)
          },
        )
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Choice
          label="Customer"
          name="customerId"
          defaultValue={initial.customerId}
          error={errors.customerId}
          className="sm:col-span-2"
          onChange={(e) => {
            const c = customers.find((x) => x.id === e.target.value)
            if (c?.address && !address) setAddress(c.address)
          }}
        >
          <option value="">Choose a customer…</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Choice>
        <Input
          label="Order date"
          name="orderDate"
          type="date"
          defaultValue={initial.orderDate}
          error={errors.orderDate}
        />
        <Input
          label="Wanted by"
          name="requestedOn"
          type="date"
          defaultValue={initial.requestedOn}
          error={errors.requestedOn}
        />
        <Choice
          label="Ship from"
          name="locationId"
          defaultValue={initial.locationId}
          error={errors.locationId}
          className="sm:col-span-2"
        >
          <option value="">Decide when shipping</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Choice>
        <Labeled label="Ship to" error={errors.shippingAddress} className="sm:col-span-2">
          {(fid, d) => (
            <textarea
              id={fid}
              rows={1}
              maxLength={500}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              aria-describedby={d}
              placeholder="Delivery address"
              className={cn(control, "min-h-9 py-2 field-sizing-content")}
            />
          )}
        </Labeled>
      </div>

      <div className="grid gap-2">
        <div className="hidden grid-cols-[12rem_minmax(0,1fr)_5rem_7rem_4.5rem_7rem_2rem] gap-2 px-1 text-xs font-medium text-muted-foreground lg:grid">
          <span>Product</span>
          <span>Description</span>
          <span className="text-right">Qty</span>
          <span className="text-right">Price</span>
          <span className="text-right">Tax %</span>
          <span className="text-right">Amount</span>
          <span />
        </div>
        <ol className="grid gap-3 lg:gap-2">
          {lines.map((l, i) => {
            const p = l.productId ? byId.get(l.productId) : undefined
            return (
              <li
                key={l.key}
                className="grid grid-cols-3 gap-2 rounded-lg border p-3 lg:grid-cols-[12rem_minmax(0,1fr)_5rem_7rem_4.5rem_7rem_2rem] lg:items-start lg:border-0 lg:p-0"
              >
                <div className="col-span-3 lg:col-span-1">
                  <Select
                    aria-label={`Line ${i + 1} product`}
                    value={l.productId}
                    className="w-full"
                    onChange={(e) => {
                      const np = byId.get(e.target.value)
                      update(l.key, {
                        productId: e.target.value,
                        ...(np
                          ? { description: np.name, unitPrice: (np.priceCents / 100).toFixed(2) }
                          : {}),
                      })
                    }}
                  >
                    <option value="">No product (service, fee)</option>
                    {products.map((pr) => (
                      <option key={pr.id} value={pr.id}>
                        {pr.name} · {pr.sku}
                      </option>
                    ))}
                  </Select>
                  {err(i, "productId") && (
                    <span className="text-xs text-danger">{err(i, "productId")}</span>
                  )}
                </div>
                <div className="col-span-3 lg:col-span-1">
                  <input
                    aria-label={`Line ${i + 1} description`}
                    value={l.description}
                    maxLength={500}
                    placeholder="What's being sold"
                    aria-invalid={!!err(i, "description") || undefined}
                    onChange={(e) => update(l.key, { description: e.target.value })}
                    className={cn(control, "h-9")}
                  />
                  {err(i, "description") && (
                    <span className="text-xs text-danger">{err(i, "description")}</span>
                  )}
                  {err(i) && <span className="text-xs text-danger">{err(i)}</span>}
                  {!err(i) && p && available?.[i] != null && (
                    <span className="text-xs text-muted-foreground">
                      {available[i]} on hand at the ship-from location
                    </span>
                  )}
                </div>
                {(
                  [
                    ["quantity", p ? `Qty (${p.unit})` : "Qty", "1"],
                    ["unitPrice", "Price", "0.00"],
                    ["taxRate", "Tax %", "0"],
                  ] as const
                ).map(([f, label, ph]) => (
                  <label key={f} className="grid gap-1 text-xs text-muted-foreground lg:block">
                    <span className="lg:sr-only">{label}</span>
                    <input
                      aria-label={`Line ${i + 1} ${label}`}
                      inputMode="decimal"
                      value={l[f]}
                      placeholder={ph}
                      aria-invalid={!!err(i, f) || undefined}
                      onChange={(e) => update(l.key, { [f]: e.target.value })}
                      className={cn(control, "h-9 text-right text-foreground tabular-nums")}
                    />
                    {err(i, f) && <span className="text-danger">{err(i, f)}</span>}
                  </label>
                ))}
                <p className="col-span-2 self-center text-sm tabular-nums lg:col-span-1 lg:pt-2 lg:text-right">
                  <span className="text-muted-foreground lg:hidden">Amount </span>
                  {money(preview.lines[i]?.amountCents ?? 0)}
                </p>
                <div className="flex justify-end lg:pt-1">
                  <button
                    type="button"
                    aria-label={`Remove line ${i + 1}`}
                    disabled={lines.length === 1}
                    onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                    className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-danger disabled:opacity-30"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              </li>
            )
          })}
        </ol>
        {errors.lines && <span className="text-sm text-danger">{errors.lines}</span>}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              setLines((ls) => [
                ...ls,
                {
                  key: newKey(),
                  productId: "",
                  description: "",
                  quantity: "1",
                  unitPrice: "",
                  taxRate: "0",
                },
              ])
            }
          >
            <Plus /> Add line
          </Button>
          <dl className="grid min-w-56 grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm tabular-nums">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="text-right">{money(preview.subtotalCents)}</dd>
            <dt className="text-muted-foreground">Tax</dt>
            <dd className="text-right">{money(preview.taxCents)}</dd>
            <dt className="border-t pt-1 font-semibold">Total</dt>
            <dd className="border-t pt-1 text-right font-semibold">{money(preview.totalCents)}</dd>
            <dt className="sr-only">Currency</dt>
            <dd className="col-span-2 pt-1">
              <select
                aria-label="Currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className={cn(control, "h-8 w-full px-2 text-xs")}
              >
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </dd>
          </dl>
        </div>
      </div>

      <Labeled label="Notes" error={errors.notes}>
        {(fid, d) => (
          <textarea
            id={fid}
            name="notes"
            rows={2}
            maxLength={2000}
            defaultValue={initial.notes}
            aria-describedby={d}
            placeholder="Delivery instructions, special requests…"
            className={cn(control, "py-2")}
          />
        )}
      </Labeled>

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending}>
          {pending ? "Saving…" : id ? "Save changes" : "Create order"}
        </Button>
        {Object.keys(saveErrors).length > 0 && (
          <span className="text-sm text-danger">Please fix the highlighted fields.</span>
        )}
        <ErrorText>{formError}</ErrorText>
      </div>
    </form>
  )
}

// ---------- Workflow actions ----------

export function OrderActions({
  id,
  number,
  status,
  hasStockLines,
  locationId,
  locations,
  hasInvoice,
  can,
}: {
  id: string
  number: string
  status: "draft" | "confirmed" | "fulfilled" | "cancelled"
  hasStockLines: boolean
  locationId: string | null
  locations: Option[]
  hasInvoice: boolean
  can: { write: boolean; confirm: boolean; fulfill: boolean; cancel: boolean; invoice: boolean }
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [shipFrom, setShipFrom] = useState(locationId ?? "")
  const [message, setMessage] = useState<string | null>(null)
  const act = (fn: () => Promise<OrderResult>, then?: (r: OrderResult & { ok: true }) => void) =>
    start(async () => {
      setMessage(null)
      const r = await fn()
      if (!r.ok) {
        const lines = r.fieldErrors ? Object.values(r.fieldErrors) : []
        setMessage([r.error, ...lines].join(" "))
      } else then?.(r)
      router.refresh()
    })
  return (
    <div className="grid justify-items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        {status === "draft" && can.confirm && (
          <Button disabled={pending} onClick={() => act(() => confirmOrderAction(id))}>
            Confirm order
          </Button>
        )}
        {status === "confirmed" && can.fulfill && (
          <>
            {hasStockLines && (
              <Select
                aria-label="Ship from"
                value={shipFrom}
                onChange={(e) => setShipFrom(e.target.value)}
                className="w-44"
              >
                <option value="">Ship from…</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            )}
            <Button
              disabled={pending || (hasStockLines && !shipFrom)}
              onClick={() => {
                if (
                  !confirm(
                    `Mark ${number} as fulfilled?${hasStockLines ? " Its products are taken out of stock now." : ""}`,
                  )
                )
                  return
                act(() => fulfillOrderAction(id, shipFrom || null))
              }}
            >
              Fulfill
            </Button>
          </>
        )}
        {(status === "confirmed" || status === "fulfilled") && can.invoice && !hasInvoice && (
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() =>
              act(
                () => invoiceOrderAction(id),
                (r) => r.id && router.push(`/invoices/${r.id}`),
              )
            }
          >
            Create invoice
          </Button>
        )}
        {can.write && status !== "draft" && (
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() =>
              act(
                () => duplicateOrderAction(id),
                (r) => r.id && router.push(`/orders/${r.id}`),
              )
            }
          >
            Duplicate
          </Button>
        )}
        {status === "confirmed" && can.cancel && (
          <Button
            variant="danger"
            disabled={pending}
            onClick={() => {
              const reason = prompt(`Why is ${number} being cancelled?`)
              if (reason !== null) act(() => cancelOrderAction(id, reason))
            }}
          >
            Cancel order
          </Button>
        )}
        {status === "draft" && can.write && (
          <Button
            variant="danger"
            disabled={pending}
            onClick={() => {
              if (confirm(`Delete draft ${number}?`)) act(() => deleteDraftOrderAction(id))
            }}
          >
            <Trash2 /> Delete
          </Button>
        )}
      </div>
      {message && (
        <p role="alert" className="max-w-md text-right text-sm text-danger">
          {message}
        </p>
      )}
    </div>
  )
}

export function OrderNoteBox({ id }: { id: string }) {
  const { pending, submit, errors, formError } = useOrderAction()
  const [key, setKey] = useState(0)
  return (
    <form
      key={key}
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        const body = String(new FormData(e.currentTarget).get("body") ?? "")
        submit(
          () => addOrderNoteAction(id, body),
          () => setKey((k) => k + 1),
        )
      }}
    >
      <textarea
        name="body"
        rows={2}
        maxLength={2000}
        aria-label="Add a note"
        placeholder="Add a note…"
        className={cn(control, "py-2")}
      />
      <div className="flex items-center gap-3">
        <Button size="sm" variant="ghost" disabled={pending}>
          Add note
        </Button>
        {(errors.body || formError) && (
          <span className="text-xs text-danger">{errors.body ?? formError}</span>
        )}
      </div>
    </form>
  )
}
