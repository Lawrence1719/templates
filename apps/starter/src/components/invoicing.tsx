"use client"

import {
  CURRENCIES,
  computeTotals,
  formatMoney,
  type InvoiceInput,
  MAX_LINES,
  METHOD_LABELS,
  PAYMENT_METHODS,
  type PaymentInput,
  parsePercent,
  parseQuantity,
  parseSignedMoney,
  type SettingsInput,
  today,
} from "@templates/invoicing/definitions"
import { Button } from "@templates/ui/button"
import { cn } from "@templates/ui/cn"
import { ErrorText } from "@templates/ui/form"
import { ArrowDown, ArrowUp, Check, Copy, Plus, Trash2, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import {
  convertQuoteAction,
  deleteDraftAction,
  deletePaymentAction,
  duplicateInvoiceAction,
  type InvoiceResult,
  recordPaymentAction,
  remindInvoiceAction,
  saveDraftAction,
  saveSettingsAction,
  sendInvoiceAction,
  setQuoteStatusAction,
  voidInvoiceAction,
} from "@/app/actions/invoicing"
import { Choice, control, Input, Labeled } from "@/components/fields"

type Customer = { id: string; name: string; email: string | null }

function useInvoiceAction() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [result, setResult] = useState<InvoiceResult | null>(null)
  const submit = (
    fn: () => Promise<InvoiceResult>,
    onOk?: (r: InvoiceResult & { ok: true }) => void,
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
  const message = result?.ok ? result.message : undefined
  return { pending, submit, errors, formError, message, reset: () => setResult(null) }
}

// ---------- Editor ----------

type LineDraft = {
  key: string
  description: string
  quantity: string
  unitPrice: string
  taxRate: string
}
export type DraftValues = {
  customerId: string
  issueDate: string
  dueOn: string
  currency: string
  notes: string
  terms: string
  lines: Omit<LineDraft, "key">[]
}

const newKey = () => Math.random().toString(36).slice(2)

/** Draft quote/invoice editor. Totals use the exact functions the server stores. */
export function InvoiceEditor({
  id,
  kind,
  initial,
  customers,
  defaultTaxRate,
  canDelete,
}: {
  id: string | null
  kind: "quote" | "invoice"
  initial: DraftValues
  customers: Customer[]
  defaultTaxRate: string
  canDelete: boolean
}) {
  const router = useRouter()
  const { pending, submit, errors, formError } = useInvoiceAction()
  const [lines, setLines] = useState<LineDraft[]>(() =>
    (initial.lines.length
      ? initial.lines
      : [{ description: "", quantity: "1", unitPrice: "", taxRate: defaultTaxRate }]
    ).map((l) => ({ ...l, key: newKey() })),
  )
  const [currency, setCurrency] = useState(initial.currency)
  const [deleting, startDelete] = useTransition()

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
  const move = (i: number, d: -1 | 1) =>
    setLines((ls) => {
      const next = [...ls]
      const [it] = next.splice(i, 1)
      if (it) next.splice(i + d, 0, it)
      return next
    })
  const lineError = (i: number, f: string) => errors[`lines.${i}.${f}`]

  return (
    <form
      noValidate
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        const input = {
          customerId: String(f.get("customerId") ?? ""),
          issueDate: String(f.get("issueDate") ?? ""),
          dueOn: String(f.get("dueOn") ?? ""),
          currency,
          notes: String(f.get("notes") ?? ""),
          terms: String(f.get("terms") ?? ""),
          lines: lines.map(({ key: _key, ...l }) => l),
        } as InvoiceInput // The server re-validates everything.
        submit(
          () => saveDraftAction(id, kind, input),
          (r) => {
            if (!id && r.id) router.push(`/invoices/${r.id}`)
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
        >
          <option value="">Choose a customer…</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Choice>
        <Input
          label="Issue date"
          name="issueDate"
          type="date"
          defaultValue={initial.issueDate}
          error={errors.issueDate}
        />
        <Input
          label={kind === "quote" ? "Valid until" : "Due date"}
          name="dueOn"
          type="date"
          defaultValue={initial.dueOn}
          error={errors.dueOn}
        />
      </div>

      <div className="grid gap-2">
        <div className="hidden grid-cols-[minmax(0,1fr)_5rem_7rem_5rem_7rem_4.5rem] gap-2 px-1 text-xs font-medium text-muted-foreground md:grid">
          <span>Description</span>
          <span className="text-right">Qty</span>
          <span className="text-right">Price</span>
          <span className="text-right">Tax %</span>
          <span className="text-right">Amount</span>
          <span />
        </div>
        <ol className="grid gap-3 md:gap-2">
          {lines.map((l, i) => {
            const amount = preview.lines[i]?.amountCents ?? 0
            return (
              <li
                key={l.key}
                className="grid grid-cols-3 gap-2 rounded-lg border p-3 md:grid-cols-[minmax(0,1fr)_5rem_7rem_5rem_7rem_4.5rem] md:items-start md:border-0 md:p-0"
              >
                <div className="col-span-3 md:col-span-1">
                  <textarea
                    aria-label={`Line ${i + 1} description`}
                    rows={1}
                    value={l.description}
                    maxLength={500}
                    placeholder="What you're charging for"
                    aria-invalid={!!lineError(i, "description") || undefined}
                    onChange={(e) => update(l.key, { description: e.target.value })}
                    className={cn(control, "min-h-9 py-2 field-sizing-content")}
                  />
                  {lineError(i, "description") && (
                    <span className="text-xs text-danger">{lineError(i, "description")}</span>
                  )}
                </div>
                {(
                  [
                    ["quantity", "Qty", "1"],
                    ["unitPrice", "Price", "0.00"],
                    ["taxRate", "Tax %", "0"],
                  ] as const
                ).map(([f, labelText, ph]) => (
                  <label key={f} className="grid gap-1 text-xs text-muted-foreground md:block">
                    <span className="md:sr-only">{labelText}</span>
                    <input
                      aria-label={`Line ${i + 1} ${labelText}`}
                      inputMode="decimal"
                      value={l[f]}
                      placeholder={ph}
                      aria-invalid={!!lineError(i, f) || undefined}
                      onChange={(e) => update(l.key, { [f]: e.target.value })}
                      className={cn(control, "h-9 text-right text-foreground tabular-nums")}
                    />
                    {lineError(i, f) && <span className="text-danger">{lineError(i, f)}</span>}
                  </label>
                ))}
                <p className="col-span-2 self-center text-sm tabular-nums md:col-span-1 md:pt-2 md:text-right">
                  <span className="text-muted-foreground md:hidden">Amount </span>
                  {money(amount)}
                </p>
                <div className="flex justify-end gap-0.5 md:pt-0.5">
                  <button
                    type="button"
                    aria-label={`Move line ${i + 1} up`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30"
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move line ${i + 1} down`}
                    disabled={i === lines.length - 1}
                    onClick={() => move(i, 1)}
                    className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30"
                  >
                    <ArrowDown className="size-3.5" />
                  </button>
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
            disabled={lines.length >= MAX_LINES}
            onClick={() =>
              setLines((ls) => [
                ...ls,
                {
                  key: newKey(),
                  description: "",
                  quantity: "1",
                  unitPrice: "",
                  taxRate: defaultTaxRate,
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

      <div className="grid gap-4 sm:grid-cols-2">
        {(["notes", "terms"] as const).map((f) => (
          <Labeled
            key={f}
            label={f === "notes" ? "Notes for the customer" : "Terms"}
            error={errors[f]}
          >
            {(fid, d) => (
              <textarea
                id={fid}
                name={f}
                rows={3}
                maxLength={2000}
                defaultValue={initial[f]}
                aria-describedby={d}
                placeholder={
                  f === "notes" ? "Thank you for your business!" : "Payment due within 30 days."
                }
                className={cn(control, "py-2")}
              />
            )}
          </Labeled>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending}>
          {pending ? "Saving…" : id ? "Save draft" : `Create ${kind}`}
        </Button>
        {Object.keys(errors).length > 0 && (
          <span className="text-sm text-danger">Please fix the highlighted fields.</span>
        )}
        <ErrorText>{formError}</ErrorText>
        {id && canDelete && (
          <Button
            type="button"
            variant="danger"
            className="ml-auto"
            disabled={deleting}
            onClick={() => {
              if (!confirm("Delete this draft?")) return
              startDelete(async () => {
                const r = await deleteDraftAction(id)
                if (r && !r.ok) alert(r.error)
              })
            }}
          >
            <Trash2 /> Delete draft
          </Button>
        )}
      </div>
    </form>
  )
}

// ---------- Actions on a document ----------

function ActionButton({
  label,
  run,
  confirmText,
  variant = "ghost",
  onDone,
}: {
  label: string
  run: () => Promise<InvoiceResult>
  confirmText?: string
  variant?: "primary" | "ghost" | "danger"
  onDone?: (r: InvoiceResult & { ok: true }) => void
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <Button
      variant={variant}
      disabled={pending}
      onClick={() => {
        if (confirmText && !confirm(confirmText)) return
        start(async () => {
          const r = await run()
          if (!r.ok) alert(r.error)
          else {
            if (r.message) alert(r.message)
            onDone?.(r)
          }
          router.refresh()
        })
      }}
    >
      {label}
    </Button>
  )
}

export function DocumentActions({
  id,
  kind,
  state,
  number,
  hasEmail,
  shareUrl,
  convertedToId,
  can,
}: {
  id: string
  kind: "quote" | "invoice"
  state: string
  number: string | null
  hasEmail: boolean
  shareUrl: string | null
  convertedToId: string | null
  can: { send: boolean; void: boolean; write: boolean }
}) {
  const router = useRouter()
  const [copied, setCopied] = useState(false)
  const go = (r: InvoiceResult & { ok: true }) => r.id && router.push(`/invoices/${r.id}`)
  const draft = state === "draft"
  const unpaid = kind === "invoice" && ["open", "partial", "overdue"].includes(state)
  const liveQuote = kind === "quote" && ["sent", "accepted", "expired"].includes(state)
  return (
    <div className="flex flex-wrap gap-2">
      {draft && can.send && (
        <>
          {hasEmail && (
            <ActionButton
              variant="primary"
              label="Send by email"
              confirmText={`Send this ${kind} to the customer? It gets a number and can't be edited after.`}
              run={() => sendInvoiceAction(id, true)}
            />
          )}
          <ActionButton
            variant={hasEmail ? "ghost" : "primary"}
            label={hasEmail ? "Finalize without email" : `Finalize ${kind}`}
            confirmText={`Finalize this ${kind}? It gets a number and can't be edited after.`}
            run={() => sendInvoiceAction(id, false)}
          />
        </>
      )}
      {shareUrl && (
        <>
          <Button
            variant="ghost"
            onClick={async () => {
              await navigator.clipboard.writeText(shareUrl)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
          >
            {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy link"}
          </Button>
          <a
            href={shareUrl}
            target="_blank"
            rel="noopener"
            className="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium hover:bg-accent"
          >
            Print / PDF
          </a>
        </>
      )}
      {unpaid && can.send && hasEmail && (
        <ActionButton
          label="Send reminder"
          run={() => remindInvoiceAction(id)}
          confirmText="Email a payment reminder?"
        />
      )}
      {liveQuote && can.send && !convertedToId && (
        <ActionButton
          variant="primary"
          label="Convert to invoice"
          run={() => convertQuoteAction(id)}
          onDone={go}
        />
      )}
      {convertedToId && (
        <a
          href={`/invoices/${convertedToId}`}
          className="inline-flex h-9 items-center px-2 text-sm underline"
        >
          View invoice
        </a>
      )}
      {kind === "quote" && state === "sent" && can.send && (
        <ActionButton label="Mark declined" run={() => setQuoteStatusAction(id, false)} />
      )}
      {!draft && can.write && (
        <ActionButton label="Duplicate" run={() => duplicateInvoiceAction(id)} onDone={go} />
      )}
      {!draft && state !== "void" && can.void && (
        <ActionButton
          variant="danger"
          label="Void"
          confirmText={`Void ${number}? It stays on record as void and can't be undone.`}
          run={() => voidInvoiceAction(id)}
        />
      )}
    </div>
  )
}

// ---------- Payments ----------

export function PaymentForm({
  invoiceId,
  balance,
  currency,
}: {
  invoiceId: string
  balance: number
  currency: string
}) {
  const { pending, submit, errors, formError } = useInvoiceAction()
  const [key, setKey] = useState(0)
  return (
    <form
      key={key}
      noValidate
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        const v = Object.fromEntries(new FormData(e.currentTarget)) as unknown as PaymentInput
        submit(
          () => recordPaymentAction(invoiceId, v),
          () => setKey((k) => k + 1),
        )
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Input
          label={`Amount (${currency})`}
          name="amount"
          inputMode="decimal"
          defaultValue={(balance / 100).toFixed(2)}
          error={errors.amount}
        />
        <Input
          label="Date"
          name="paidOn"
          type="date"
          defaultValue={today()}
          error={errors.paidOn}
        />
        <Choice label="Method" name="method" defaultValue="bank_transfer" error={errors.method}>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {METHOD_LABELS[m]}
            </option>
          ))}
        </Choice>
        <Input
          label="Reference"
          name="reference"
          maxLength={100}
          placeholder="Optional"
          error={errors.reference}
        />
      </div>
      <ErrorText>{formError}</ErrorText>
      <Button disabled={pending}>{pending ? "Recording…" : "Record payment"}</Button>
    </form>
  )
}

export function DeletePaymentButton({ id }: { id: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <button
      type="button"
      aria-label="Remove payment"
      disabled={pending}
      onClick={() => {
        if (!confirm("Remove this payment? The balance goes back up.")) return
        start(async () => {
          const r = await deletePaymentAction(id)
          if (!r.ok) alert(r.error)
          router.refresh()
        })
      }}
      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-danger"
    >
      <X className="size-3.5" />
    </button>
  )
}

// ---------- Settings ----------

export function SettingsForm({ initial }: { initial: Record<keyof SettingsInput, string> }) {
  const { pending, submit, errors, formError } = useInvoiceAction()
  const [saved, setSaved] = useState(false)
  const area = (name: keyof SettingsInput, labelText: string, hint?: string) => (
    <Labeled label={labelText} error={errors[name]} hint={hint} className="sm:col-span-2">
      {(fid, d) => (
        <textarea
          id={fid}
          name={name}
          rows={3}
          maxLength={1000}
          defaultValue={initial[name]}
          aria-describedby={d}
          className={cn(control, "py-2")}
        />
      )}
    </Labeled>
  )
  return (
    <form
      noValidate
      className="grid gap-5 sm:grid-cols-2"
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
      <Input
        label="Invoice prefix"
        name="invoicePrefix"
        defaultValue={initial.invoicePrefix}
        error={errors.invoicePrefix}
      />
      <Input
        label="Next invoice number"
        name="nextInvoiceNumber"
        type="number"
        min={1}
        defaultValue={initial.nextInvoiceNumber}
        error={errors.nextInvoiceNumber}
        hint="Can only go up, so numbers are never reused."
      />
      <Input
        label="Quote prefix"
        name="quotePrefix"
        defaultValue={initial.quotePrefix}
        error={errors.quotePrefix}
      />
      <Input
        label="Next quote number"
        name="nextQuoteNumber"
        type="number"
        min={1}
        defaultValue={initial.nextQuoteNumber}
        error={errors.nextQuoteNumber}
      />
      <Input
        label="Payment due after (days)"
        name="defaultDueDays"
        type="number"
        min={0}
        defaultValue={initial.defaultDueDays}
        error={errors.defaultDueDays}
      />
      <Input
        label="Default tax rate (%)"
        name="defaultTaxRate"
        inputMode="decimal"
        defaultValue={initial.defaultTaxRate}
        error={errors.defaultTaxRate}
      />
      <Choice
        label="Default currency"
        name="defaultCurrency"
        defaultValue={initial.defaultCurrency}
      >
        {CURRENCIES.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </Choice>
      <Input
        label="Business name on documents"
        name="businessName"
        defaultValue={initial.businessName}
        error={errors.businessName}
      />
      {area(
        "businessDetails",
        "Your address and tax number",
        "Shown under your name on every document.",
      )}
      {area(
        "paymentInstructions",
        "How to pay",
        "Bank details, payment link or other instructions. Shown on invoices.",
      )}
      {area("footer", "Footer")}
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button disabled={pending}>{pending ? "Saving…" : "Save settings"}</Button>
        {saved && <span className="text-sm text-success">Saved</span>}
        <ErrorText>{formError}</ErrorText>
      </div>
    </form>
  )
}
