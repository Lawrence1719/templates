"use client"

import {
  CASH_MOVEMENT_LABELS,
  type CashMovementKind,
  centsToInput,
  computeCart,
  formatMoney,
  formatPercent,
  formatQuantity,
  parseMoney,
  parsePercent,
  parseQuantity,
  settlePayments,
  TENDER_LABELS,
  TENDERS,
  type Tender,
} from "@templates/pos/definitions"
import { Button } from "@templates/ui/button"
import { cn } from "@templates/ui/cn"
import { ErrorText, Select } from "@templates/ui/form"
import { Dialog, DialogContent } from "@templates/ui/sheet"
import { Banknote, Minus, PackagePlus, Plus, Printer, ScanLine, Trash2, X } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState, useTransition } from "react"

import {
  cashMovementAction,
  checkoutAction,
  closeShiftAction,
  openShiftAction,
  type PosResult,
} from "@/app/actions/pos"
import { control, Input } from "@/components/fields"

export type TillProduct = {
  id: string
  sku: string
  barcode: string | null
  name: string
  category: string | null
  unit: string
  priceCents: number
  onHandMilli: number
}

type TillSettings = {
  currency: string
  taxRateBp: number
  pricesIncludeTax: boolean
  maxDiscountBp: number
}

type CartLine = {
  key: string
  productId: string | null
  description: string
  unitPrice: string
  quantity: string
  discount: string
}

type Payment = { key: string; tender: Tender; amount: string; reference: string }

type Done = { id: string; number: string; changeCents: number; totalCents: number }

const newKey = () => Math.random().toString(36).slice(2)
const newSaleKey = () => crypto.randomUUID()

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
  return { pending, submit, errors, formError, reset: () => setResult(null) }
}

// Keep the cart (and its sale key) through a reload or a dropped connection, so a retry
// sends the same key and can't charge twice. Browser storage can be unavailable: that's fine.
const storageKey = (registerId: string) => `pos-cart:${registerId}`
function loadCart(
  registerId: string,
): { saleKey: string; lines: CartLine[]; customerId: string } | null {
  try {
    const raw = sessionStorage.getItem(storageKey(registerId))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
function saveCart(
  registerId: string,
  v: { saleKey: string; lines: CartLine[]; customerId: string },
) {
  try {
    if (v.lines.length) sessionStorage.setItem(storageKey(registerId), JSON.stringify(v))
    else sessionStorage.removeItem(storageKey(registerId))
  } catch {}
}

// ---------- Opening a shift ----------

export function OpenShift({ registerId, currency }: { registerId: string; currency: string }) {
  const { pending, submit, errors, formError } = useAction()
  return (
    <form
      noValidate
      className="mx-auto grid w-full max-w-sm gap-4 rounded-xl border p-6"
      onSubmit={(e) => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        submit(() => openShiftAction(registerId, { openingFloat: String(f.get("float") ?? "") }))
      }}
    >
      <div>
        <h2 className="text-lg font-semibold">Open the till</h2>
        <p className="text-sm text-muted-foreground">
          Count the cash in the drawer before your first sale.
        </p>
      </div>
      <Input
        label={`Cash in the drawer (${currency})`}
        name="float"
        inputMode="decimal"
        placeholder="0.00"
        autoFocus
        error={errors.openingFloat}
      />
      <ErrorText>{formError}</ErrorText>
      <Button disabled={pending}>{pending ? "Opening…" : "Open shift"}</Button>
    </form>
  )
}

// ---------- The till ----------

export function Till({
  registerId,
  registerName,
  shift,
  products,
  customers,
  settings,
  canDiscountAny,
}: {
  registerId: string
  registerName: string
  shift: { id: string; openedAt: string; openedBy: string | null }
  products: TillProduct[]
  customers: { id: string; name: string }[]
  settings: TillSettings
  canDiscountAny: boolean
}) {
  const [saleKey, setSaleKey] = useState(newSaleKey)
  const [lines, setLines] = useState<CartLine[]>([])
  const [customerId, setCustomerId] = useState("")
  const [restored, setRestored] = useState(false)
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<string | null>(null)
  const [paying, setPaying] = useState(false)
  const [done, setDone] = useState<Done | null>(null)
  const [custom, setCustom] = useState(false)
  const [notFound, setNotFound] = useState<string | null>(null)
  const search = useRef<HTMLInputElement>(null)
  const money = (c: number) => formatMoney(c, settings.currency)

  useEffect(() => {
    const saved = loadCart(registerId)
    if (saved) {
      setSaleKey(saved.saleKey)
      setLines(saved.lines)
      setCustomerId(saved.customerId)
    }
    setRestored(true)
  }, [registerId])
  useEffect(() => {
    if (restored) saveCart(registerId, { saleKey, lines, customerId })
  }, [registerId, saleKey, lines, customerId, restored])

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const categories = useMemo(
    () => [...new Set(products.map((p) => p.category).filter((c): c is string => !!c))].sort(),
    [products],
  )
  const q = query.trim().toLowerCase()
  const shown = products.filter(
    (p) =>
      (!category || p.category === category) &&
      (!q ||
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.barcode?.toLowerCase() === q),
  )

  const cart = computeCart(
    lines.map((l) => ({
      quantityMilli: parseQuantity(l.quantity || "0") ?? 0,
      unitPriceCents: parseMoney(l.unitPrice || "0") ?? 0,
      discountBp: parsePercent(l.discount || "0") ?? 0,
    })),
    settings,
  )

  const add = (p: TillProduct) => {
    setNotFound(null)
    setLines((ls) => {
      const i = ls.findIndex((l) => l.productId === p.id && !l.discount)
      if (i >= 0) {
        const l = ls[i] as CartLine
        const next = ((parseQuantity(l.quantity) ?? 0) + 1000) / 1000
        return ls.map((x, j) => (j === i ? { ...x, quantity: String(next) } : x))
      }
      return [
        ...ls,
        {
          key: newKey(),
          productId: p.id,
          description: p.name,
          unitPrice: centsToInput(p.priceCents),
          quantity: "1",
          discount: "",
        },
      ]
    })
  }
  const update = (key: string, patch: Partial<CartLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const bump = (l: CartLine, by: number) => {
    const next = ((parseQuantity(l.quantity) ?? 0) + by * 1000) / 1000
    if (next <= 0) setLines((ls) => ls.filter((x) => x.key !== l.key))
    else update(l.key, { quantity: String(next) })
  }
  const clear = () => {
    setLines([])
    setCustomerId("")
    setSaleKey(newSaleKey())
  }

  /** Enter in the search box: an exact barcode or SKU adds it, as does a single match. */
  const scan = () => {
    if (!q) return
    const exact = products.find((p) => p.barcode?.toLowerCase() === q || p.sku.toLowerCase() === q)
    const hit = exact ?? (shown.length === 1 ? shown[0] : undefined)
    if (hit) {
      add(hit)
      setQuery("")
    } else setNotFound(query.trim())
  }

  if (done)
    return (
      <SaleDone
        done={done}
        money={money}
        onNext={() => {
          setDone(null)
          setTimeout(() => search.current?.focus(), 0)
        }}
      />
    )

  return (
    <div className="grid gap-4">
      <ShiftBar
        registerName={registerName}
        shift={shift}
        currency={settings.currency}
        cartEmpty={lines.length === 0}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        {/* Products */}
        <section aria-label="Products" className="grid content-start gap-3">
          <div className="relative">
            <ScanLine className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={search}
              type="search"
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setNotFound(null)
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  scan()
                }
              }}
              aria-label="Scan a barcode or search products"
              placeholder="Scan a barcode or search…"
              className={cn(control, "h-11 pl-9 text-base")}
            />
          </div>
          {notFound && (
            <p role="alert" className="text-sm text-danger">
              Nothing matches “{notFound}”.
            </p>
          )}
          {categories.length > 0 && (
            <div className="flex flex-wrap gap-1.5 text-sm" role="group" aria-label="Category">
              {[null, ...categories].map((c) => (
                <button
                  key={c ?? "all"}
                  type="button"
                  aria-pressed={category === c}
                  onClick={() => setCategory(c)}
                  className={cn(
                    "rounded-full border px-3 py-1",
                    category === c
                      ? "border-foreground bg-accent font-medium"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {c ?? "All"}
                </button>
              ))}
            </div>
          )}
          {products.length === 0 ? (
            <p className="rounded-xl border p-8 text-center text-sm text-muted-foreground">
              No products priced in {settings.currency} yet. Add them in{" "}
              <Link href="/inventory" className="underline">
                Inventory
              </Link>
              , or ring up a custom item.
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {shown.slice(0, 120).map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => add(p)}
                    className="grid h-full w-full gap-1 rounded-lg border p-3 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <span className="line-clamp-2 text-sm font-medium">{p.name}</span>
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="tabular-nums">{money(p.priceCents)}</span>
                      <span
                        className={cn(
                          "text-xs tabular-nums",
                          p.onHandMilli <= 0 ? "text-danger" : "text-muted-foreground",
                        )}
                      >
                        {p.onHandMilli <= 0
                          ? "None left"
                          : `${formatQuantity(p.onHandMilli)} ${p.unit}`}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
              {shown.length === 0 && (
                <li className="col-span-full p-6 text-center text-sm text-muted-foreground">
                  No products match.
                </li>
              )}
            </ul>
          )}
          <div>
            <Button variant="ghost" type="button" onClick={() => setCustom(true)}>
              <PackagePlus /> Custom item
            </Button>
          </div>
        </section>

        {/* Cart */}
        <section
          aria-label="Current sale"
          className="grid content-start gap-3 rounded-xl border p-4 lg:sticky lg:top-4 lg:self-start"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Current sale</h2>
            {lines.length > 0 && (
              <Button variant="quiet" size="sm" type="button" onClick={clear}>
                Clear
              </Button>
            )}
          </div>
          {lines.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Scan or tap a product to start.
            </p>
          ) : (
            <ul className="grid divide-y">
              {lines.map((l, i) => {
                const c = cart.lines[i]
                const p = l.productId ? byId.get(l.productId) : null
                return (
                  <li key={l.key} className="grid gap-2 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{l.description}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {money(parseMoney(l.unitPrice) ?? 0)}
                          {p ? ` · ${p.sku}` : " · custom"}
                        </p>
                      </div>
                      <span className="text-sm font-medium tabular-nums">
                        {money(c?.totalCents ?? 0)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center rounded-md border">
                        <button
                          type="button"
                          aria-label={`One less ${l.description}`}
                          className="grid size-8 place-items-center hover:bg-accent [&_svg]:size-3.5"
                          onClick={() => bump(l, -1)}
                        >
                          <Minus />
                        </button>
                        <input
                          aria-label={`Quantity of ${l.description}`}
                          inputMode="decimal"
                          value={l.quantity}
                          onChange={(e) => update(l.key, { quantity: e.target.value })}
                          className="h-8 w-12 bg-transparent text-center text-sm tabular-nums outline-none"
                        />
                        <button
                          type="button"
                          aria-label={`One more ${l.description}`}
                          className="grid size-8 place-items-center hover:bg-accent [&_svg]:size-3.5"
                          onClick={() => bump(l, 1)}
                        >
                          <Plus />
                        </button>
                      </div>
                      <label className="flex items-center gap-1 text-xs text-muted-foreground">
                        Off
                        <input
                          inputMode="decimal"
                          value={l.discount}
                          placeholder="0"
                          onChange={(e) => update(l.key, { discount: e.target.value })}
                          className="h-8 w-12 rounded-md border bg-transparent px-1.5 text-right text-sm text-foreground tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                        %
                      </label>
                      <button
                        type="button"
                        aria-label={`Remove ${l.description}`}
                        className="ml-auto grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-danger/10 hover:text-danger [&_svg]:size-4"
                        onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                      >
                        <Trash2 />
                      </button>
                    </div>
                    {!canDiscountAny &&
                      (parsePercent(l.discount || "0") ?? 0) > settings.maxDiscountBp && (
                        <p className="text-xs text-danger">
                          Up to {formatPercent(settings.maxDiscountBp)} without a manager
                        </p>
                      )}
                  </li>
                )
              })}
            </ul>
          )}

          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Customer</span>
            <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Walk-in</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </label>

          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t pt-3 text-sm tabular-nums">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="text-right">{money(cart.subtotalCents)}</dd>
            {cart.discountCents > 0 && (
              <>
                <dt className="text-muted-foreground">Discounts</dt>
                <dd className="text-right">−{money(cart.discountCents)}</dd>
              </>
            )}
            {settings.taxRateBp > 0 && (
              <>
                <dt className="text-muted-foreground">
                  Tax {formatPercent(settings.taxRateBp)}
                  {settings.pricesIncludeTax ? " (included)" : ""}
                </dt>
                <dd className="text-right">{money(cart.taxCents)}</dd>
              </>
            )}
            <dt className="pt-1 text-base font-semibold">Total</dt>
            <dd className="pt-1 text-right text-base font-semibold">{money(cart.totalCents)}</dd>
          </dl>
          <Button
            type="button"
            className="h-12 text-base"
            disabled={lines.length === 0}
            onClick={() => setPaying(true)}
          >
            Charge {money(cart.totalCents)}
          </Button>
        </section>
      </div>

      <CustomItemDialog
        open={custom}
        onOpenChange={setCustom}
        currency={settings.currency}
        onAdd={(l) => setLines((ls) => [...ls, { ...l, key: newKey() }])}
      />
      <PayDialog
        open={paying}
        onOpenChange={setPaying}
        totalCents={cart.totalCents}
        currency={settings.currency}
        lineLabels={lines.map((l) => l.description)}
        submitSale={(payments) =>
          checkoutAction({
            registerId,
            clientKey: saleKey,
            customerId: customerId || null,
            lines: lines.map((l) =>
              l.productId
                ? { productId: l.productId, quantity: l.quantity, discount: l.discount }
                : {
                    description: l.description,
                    unitPrice: l.unitPrice,
                    quantity: l.quantity,
                    discount: l.discount,
                  },
            ),
            payments,
          })
        }
        onDone={(r) => {
          setPaying(false)
          setDone({
            id: r.id ?? "",
            number: r.number ?? "",
            changeCents: r.changeCents ?? 0,
            totalCents: cart.totalCents,
          })
          clear()
        }}
      />
    </div>
  )
}

// ---------- Paying ----------

function PayDialog({
  open,
  onOpenChange,
  totalCents,
  currency,
  lineLabels,
  submitSale,
  onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  totalCents: number
  currency: string
  lineLabels: string[]
  submitSale: (
    p: { tender: Tender; amount: string; reference: string | null }[],
  ) => Promise<PosResult>
  onDone: (r: PosResult & { ok: true }) => void
}) {
  const [payments, setPayments] = useState<Payment[]>([])
  const [tender, setTender] = useState<Tender>("cash")
  const [amount, setAmount] = useState("")
  const [reference, setReference] = useState("")
  const [pending, start] = useTransition()
  const [error, setError] = useState<{ message: string; lines: string[] } | null>(null)
  const money = (c: number) => formatMoney(c, currency)

  const paidSoFar = payments.reduce((s, p) => s + (parseMoney(p.amount) ?? 0), 0)
  const remaining = Math.max(0, totalCents - paidSoFar)

  useEffect(() => {
    if (open) {
      setPayments([])
      setTender("cash")
      setAmount(centsToInput(totalCents))
      setReference("")
      setError(null)
    }
  }, [open, totalCents])

  const asTendered = (list: Payment[]) =>
    list.map((p) => ({
      tender: p.tender,
      tenderedCents: parseMoney(p.amount) ?? 0,
      reference: p.reference || null,
    }))
  const draft: Payment[] = amount
    ? [...payments, { key: "draft", tender, amount, reference }]
    : payments
  const preview = settlePayments(totalCents, asTendered(draft))
  const canFinish = preview.ok

  // Quick cash: the exact amount and the next round notes above it.
  const quick = useMemo(() => {
    const due = remaining
    const steps = [100, 500, 1000, 2000, 5000, 10_000, 50_000, 100_000]
    const out = new Set<number>([due])
    for (const s of steps) {
      const up = Math.ceil(due / s) * s
      if (up > due) out.add(up)
      if (out.size >= 4) break
    }
    return [...out].filter((c) => c > 0)
  }, [remaining])

  const addPayment = () => {
    const cents = parseMoney(amount)
    if (!cents) return
    const next = [...payments, { key: newKey(), tender, amount, reference }]
    setPayments(next)
    const left = Math.max(0, totalCents - next.reduce((s, p) => s + (parseMoney(p.amount) ?? 0), 0))
    setAmount(left ? centsToInput(left) : "")
    setReference("")
    setTender("cash")
  }

  const finish = () =>
    start(async () => {
      setError(null)
      const list = draft.map((p) => ({
        tender: p.tender,
        amount: p.amount,
        reference: p.reference || null,
      }))
      const r = await submitSale(totalCents === 0 ? [] : list)
      if (r.ok) onDone(r)
      else {
        const fe = r.fieldErrors ?? {}
        const lineMsgs = Object.entries(fe)
          .filter(([k]) => k.startsWith("lines."))
          .map(([k, m]) => `${lineLabels[Number(k.split(".")[1])] ?? "Item"}: ${m}`)
        setError({ message: fe.payments ?? r.error, lines: lineMsgs })
      }
    })

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && onOpenChange(v)}>
      <DialogContent title="Take payment" className="top-[8vh]">
        <div className="grid gap-4 p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Total</p>
              <p className="text-3xl font-semibold tabular-nums">{money(totalCents)}</p>
            </div>
            <button
              type="button"
              aria-label="Close"
              disabled={pending}
              className="grid size-8 place-items-center rounded-md hover:bg-accent [&_svg]:size-4"
              onClick={() => onOpenChange(false)}
            >
              <X />
            </button>
          </div>

          {payments.length > 0 && (
            <ul className="grid gap-1 rounded-lg border p-2 text-sm">
              {payments.map((p) => (
                <li key={p.key} className="flex items-center justify-between gap-2">
                  <span>
                    {TENDER_LABELS[p.tender]}
                    {p.reference && <span className="text-muted-foreground"> · {p.reference}</span>}
                  </span>
                  <span className="flex items-center gap-2 tabular-nums">
                    {money(parseMoney(p.amount) ?? 0)}
                    <button
                      type="button"
                      aria-label={`Remove ${TENDER_LABELS[p.tender]} payment`}
                      className="text-muted-foreground hover:text-danger [&_svg]:size-3.5"
                      onClick={() => setPayments((ps) => ps.filter((x) => x.key !== p.key))}
                    >
                      <X />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {totalCents === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing to pay on this sale.</p>
          ) : (
            remaining > 0 && (
              <>
                <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Paid by">
                  {TENDERS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      role="radio"
                      aria-checked={tender === t}
                      onClick={() => {
                        setTender(t)
                        if (t !== "cash") setAmount(centsToInput(remaining))
                      }}
                      className={cn(
                        "h-10 rounded-md border text-sm font-medium",
                        tender === t ? "border-foreground bg-accent" : "text-muted-foreground",
                      )}
                    >
                      {TENDER_LABELS[t]}
                    </button>
                  ))}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    label={tender === "cash" ? "Cash handed over" : "Amount"}
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  {tender !== "cash" && (
                    <Input
                      label="Reference (optional)"
                      value={reference}
                      placeholder="Last 4 digits, slip no."
                      onChange={(e) => setReference(e.target.value)}
                    />
                  )}
                </div>
                {tender === "cash" && (
                  <div className="flex flex-wrap gap-1.5">
                    {quick.map((c) => (
                      <Button
                        key={c}
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setAmount(centsToInput(c))}
                      >
                        {c === remaining ? "Exact" : money(c)}
                      </Button>
                    ))}
                  </div>
                )}
                {(parseMoney(amount) ?? 0) < remaining && (parseMoney(amount) ?? 0) > 0 && (
                  <Button type="button" variant="ghost" onClick={addPayment}>
                    <Plus /> Add {TENDER_LABELS[tender].toLowerCase()} and split the rest
                  </Button>
                )}
              </>
            )
          )}

          <div className="rounded-lg bg-muted px-4 py-3 text-sm tabular-nums">
            {preview.ok ? (
              <p className="flex items-baseline justify-between">
                <span>Change</span>
                <span className="text-2xl font-semibold">{money(preview.changeCents)}</span>
              </p>
            ) : (
              <p className="flex items-baseline justify-between text-muted-foreground">
                <span>{preview.error === "still_due" ? "Still to pay" : preview.error}</span>
                {preview.error === "still_due" && (
                  <span className="text-lg font-semibold text-foreground">
                    {money(preview.dueCents ?? 0)}
                  </span>
                )}
              </p>
            )}
          </div>

          {error && (
            <div role="alert" className="grid gap-1 text-sm text-danger">
              <p>{error.message}</p>
              {error.lines.map((m) => (
                <p key={m} className="text-xs">
                  {m}
                </p>
              ))}
            </div>
          )}
          <Button
            type="button"
            className="h-12 text-base"
            disabled={!canFinish || pending}
            onClick={finish}
          >
            {pending ? "Saving…" : "Complete sale"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SaleDone({
  done,
  money,
  onNext,
}: {
  done: Done
  money: (c: number) => string
  onNext: () => void
}) {
  const next = useRef<HTMLButtonElement>(null)
  useEffect(() => next.current?.focus(), [])
  return (
    <div className="mx-auto grid w-full max-w-md gap-5 rounded-xl border p-6 text-center">
      <div>
        <p className="text-sm text-muted-foreground">Sale {done.number} saved</p>
        <p className="mt-1 text-sm text-muted-foreground">Change to give</p>
        <p className="text-5xl font-semibold tabular-nums" aria-live="polite">
          {money(done.changeCents)}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">Total {money(done.totalCents)}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <a
          href={`/receipt/${done.id}?print=1`}
          target="_blank"
          rel="noopener"
          className="inline-flex h-9 items-center gap-2 rounded-md border px-4 text-sm font-medium hover:bg-accent [&_svg]:size-4"
        >
          <Printer /> Print receipt
        </a>
        <Link
          href={`/pos/sales/${done.id}`}
          className="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium hover:bg-accent"
        >
          View sale
        </Link>
        <Button ref={next} onClick={onNext}>
          New sale
        </Button>
      </div>
    </div>
  )
}

function CustomItemDialog({
  open,
  onOpenChange,
  currency,
  onAdd,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  currency: string
  onAdd: (l: Omit<CartLine, "key">) => void
}) {
  const [errors, setErrors] = useState<Record<string, string>>({})
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Custom item">
        <form
          noValidate
          className="grid gap-4 p-5"
          onSubmit={(e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            const description = String(f.get("description") ?? "").trim()
            const price = String(f.get("price") ?? "")
            const quantity = String(f.get("quantity") ?? "") || "1"
            const errs: Record<string, string> = {}
            if (!description) errs.description = "Describe the item"
            if (parseMoney(price) === null) errs.price = "Enter a price like 120 or 99.50"
            if (parseQuantity(quantity) === null) errs.quantity = "Enter a quantity like 1"
            setErrors(errs)
            if (Object.keys(errs).length) return
            onAdd({ productId: null, description, unitPrice: price, quantity, discount: "" })
            onOpenChange(false)
          }}
        >
          <h2 className="font-semibold">Custom item</h2>
          <p className="-mt-2 text-sm text-muted-foreground">
            For things not in the catalog. It won't change stock.
          </p>
          <Input
            label="What is it"
            name="description"
            maxLength={200}
            autoFocus
            error={errors.description}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label={`Price (${currency})`}
              name="price"
              inputMode="decimal"
              error={errors.price}
            />
            <Input
              label="Quantity"
              name="quantity"
              inputMode="decimal"
              defaultValue="1"
              error={errors.quantity}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button>Add to sale</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------- Shift bar: cash in/out and closing ----------

const timeFmt = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" })

function ShiftBar({
  registerName,
  shift,
  currency,
  cartEmpty,
}: {
  registerName: string
  shift: { id: string; openedAt: string; openedBy: string | null }
  currency: string
  cartEmpty: boolean
}) {
  const [cash, setCash] = useState<CashMovementKind | null>(null)
  const [closing, setClosing] = useState(false)
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-2.5 text-sm">
      <p>
        <span className="font-medium">{registerName}</span>
        <span className="text-muted-foreground">
          {" "}
          · open since {timeFmt.format(new Date(shift.openedAt))}
          {shift.openedBy ? ` by ${shift.openedBy}` : ""}
        </span>
      </p>
      <div className="flex flex-wrap gap-1.5">
        <Button variant="ghost" size="sm" onClick={() => setCash("paid_in")}>
          <Banknote /> Cash in
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setCash("paid_out")}>
          <Banknote /> Cash out
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setClosing(true)}
          disabled={!cartEmpty}
          title={cartEmpty ? undefined : "Finish or clear the current sale first"}
        >
          Close shift
        </Button>
      </div>
      <CashDialog
        shiftId={shift.id}
        kind={cash}
        currency={currency}
        onClose={() => setCash(null)}
      />
      <CloseShiftDialog
        shiftId={shift.id}
        open={closing}
        currency={currency}
        onClose={() => setClosing(false)}
      />
    </div>
  )
}

function CashDialog({
  shiftId,
  kind,
  currency,
  onClose,
}: {
  shiftId: string
  kind: CashMovementKind | null
  currency: string
  onClose: () => void
}) {
  const { pending, submit, errors, formError, reset } = useAction()
  return (
    <Dialog
      open={!!kind}
      onOpenChange={(v) => {
        if (!v) {
          reset()
          onClose()
        }
      }}
    >
      <DialogContent title={kind ? CASH_MOVEMENT_LABELS[kind] : "Cash"}>
        <form
          noValidate
          className="grid gap-4 p-5"
          onSubmit={(e) => {
            e.preventDefault()
            if (!kind) return
            const f = new FormData(e.currentTarget)
            submit(
              () =>
                cashMovementAction(shiftId, {
                  kind,
                  amount: String(f.get("amount") ?? ""),
                  reason: String(f.get("reason") ?? ""),
                }),
              () => {
                reset()
                onClose()
              },
            )
          }}
        >
          <h2 className="font-semibold">{kind ? CASH_MOVEMENT_LABELS[kind] : ""}</h2>
          <p className="-mt-2 text-sm text-muted-foreground">
            {kind === "paid_in"
              ? "Cash put into the drawer, like change from the bank."
              : "Cash taken out of the drawer, like paying for supplies or a bank drop."}
          </p>
          <Input
            label={`Amount (${currency})`}
            name="amount"
            inputMode="decimal"
            autoFocus
            error={errors.amount}
          />
          <Input label="What for" name="reason" maxLength={200} error={errors.reason} />
          <ErrorText>{formError}</ErrorText>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CloseShiftDialog({
  shiftId,
  open,
  currency,
  onClose,
}: {
  shiftId: string
  open: boolean
  currency: string
  onClose: () => void
}) {
  const router = useRouter()
  const { pending, submit, errors, formError, reset } = useAction()
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          reset()
          onClose()
        }
      }}
    >
      <DialogContent title="Close shift">
        <form
          noValidate
          className="grid gap-4 p-5"
          onSubmit={(e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            submit(
              () =>
                closeShiftAction(shiftId, {
                  countedCash: String(f.get("counted") ?? ""),
                  note: String(f.get("note") ?? ""),
                }),
              () => router.push(`/pos/shifts/${shiftId}`),
            )
          }}
        >
          <h2 className="font-semibold">Close shift</h2>
          <p className="-mt-2 text-sm text-muted-foreground">
            Count all the cash in the drawer. You'll see how it compares once it's saved.
          </p>
          <Input
            label={`Cash counted (${currency})`}
            name="counted"
            inputMode="decimal"
            autoFocus
            error={errors.countedCash}
          />
          <Input label="Note (optional)" name="note" maxLength={500} error={errors.note} />
          <ErrorText>{formError}</ErrorText>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={pending}>{pending ? "Closing…" : "Close shift"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
