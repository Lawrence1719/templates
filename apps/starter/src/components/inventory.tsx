"use client"

import {
  CURRENCIES,
  formatQuantity,
  ISSUE_REASONS,
  type IssueInput,
  type ProductInput,
  REASON_LABELS,
  type ReceiveInput,
  type TransferInput,
} from "@templates/inventory/definitions"
import { Button } from "@templates/ui/button"
import { cn } from "@templates/ui/cn"
import { ErrorText } from "@templates/ui/form"
import { Plus, Trash2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import {
  countAction,
  deleteProductAction,
  type InventoryResult,
  issueAction,
  receiveAction,
  saveLocationAction,
  saveProductAction,
  setLocationStatusAction,
  setProductStatusAction,
  transferAction,
} from "@/app/actions/inventory"
import { Choice, control, Input, Labeled } from "@/components/fields"

function useInventoryAction() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [result, setResult] = useState<InventoryResult | null>(null)
  const submit = (
    fn: () => Promise<InventoryResult>,
    onOk?: (r: InventoryResult & { ok: true }) => void,
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

const values = <T,>(form: HTMLFormElement) => Object.fromEntries(new FormData(form)) as unknown as T

// ---------- Product ----------

export type ProductFormValues = Record<
  keyof ProductInput | "description" | "category" | "barcode",
  string
>

export function ProductForm({
  id,
  initial,
  categories,
}: {
  id: string | null
  initial: ProductFormValues
  categories: string[]
}) {
  const router = useRouter()
  const { pending, submit, errors, formError } = useInventoryAction()
  return (
    <form
      noValidate
      className="grid gap-5 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault()
        submit(
          () => saveProductAction(id, values<ProductInput>(e.currentTarget)),
          (r) => router.push(`/inventory/${r.id}`),
        )
      }}
    >
      <Input
        label="Name"
        name="name"
        defaultValue={initial.name}
        error={errors.name}
        maxLength={120}
        autoFocus={!id}
      />
      <Input
        label="SKU"
        name="sku"
        defaultValue={initial.sku}
        error={errors.sku}
        maxLength={40}
        hint="Your own product code. Unique."
      />
      <Input
        label="Category"
        name="category"
        defaultValue={initial.category}
        error={errors.category}
        list="categories"
        maxLength={60}
      />
      <datalist id="categories">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <Input
        label="Barcode"
        name="barcode"
        defaultValue={initial.barcode}
        error={errors.barcode}
        maxLength={64}
      />
      <Input
        label="Unit"
        name="unit"
        defaultValue={initial.unit}
        error={errors.unit}
        maxLength={12}
        hint="pcs, kg, box, L…"
      />
      <Choice label="Currency" name="currency" defaultValue={initial.currency}>
        {CURRENCIES.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </Choice>
      <Input
        label="Cost per unit"
        name="cost"
        inputMode="decimal"
        defaultValue={initial.cost}
        error={errors.cost}
      />
      <Input
        label="Selling price"
        name="price"
        inputMode="decimal"
        defaultValue={initial.price}
        error={errors.price}
      />
      <Input
        label="Reorder point"
        name="reorderPoint"
        inputMode="decimal"
        defaultValue={initial.reorderPoint}
        error={errors.reorderPoint}
        hint="Alert when total stock falls to this. 0 for no alert."
      />
      <Input
        label="Reorder quantity"
        name="reorderQty"
        inputMode="decimal"
        defaultValue={initial.reorderQty}
        error={errors.reorderQty}
        hint="How much you usually order."
      />
      <Labeled label="Description" error={errors.description} className="sm:col-span-2">
        {(fid, d) => (
          <textarea
            id={fid}
            name="description"
            rows={3}
            maxLength={2000}
            defaultValue={initial.description}
            aria-describedby={d}
            className={cn(control, "py-2")}
          />
        )}
      </Labeled>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button disabled={pending}>
          {pending ? "Saving…" : id ? "Save changes" : "Add product"}
        </Button>
        <Button type="button" variant="quiet" onClick={() => router.back()}>
          Cancel
        </Button>
        {Object.keys(errors).length > 0 && (
          <span className="text-sm text-danger">Please fix the highlighted fields.</span>
        )}
        <ErrorText>{formError}</ErrorText>
      </div>
    </form>
  )
}

export function ProductStatusActions({
  id,
  sku,
  archived,
  canDelete,
}: {
  id: string
  sku: string
  archived: boolean
  canDelete: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const act = (fn: () => Promise<InventoryResult | undefined>, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return
    start(async () => {
      const r = await fn()
      if (r && !r.ok) alert(r.error)
      router.refresh()
    })
  }
  return (
    <>
      <Button
        variant="ghost"
        disabled={pending}
        onClick={() => act(() => setProductStatusAction(id, !archived))}
      >
        {archived ? "Restore" : "Archive"}
      </Button>
      {canDelete && (
        <Button
          variant="danger"
          disabled={pending}
          onClick={() =>
            act(
              () => deleteProductAction(id),
              `Delete ${sku}? Only products with no stock history can be deleted.`,
            )
          }
        >
          <Trash2 /> Delete
        </Button>
      )}
    </>
  )
}

// ---------- Moving stock ----------

type Loc = { id: string; name: string; quantityMilli: number; active: boolean }
const TABS = [
  { id: "receive", label: "Receive" },
  { id: "issue", label: "Issue" },
  { id: "transfer", label: "Transfer" },
  { id: "count", label: "Count" },
] as const

/** Receive, issue, transfer and count from one card. Every action writes to the ledger. */
export function StockActions({
  productId,
  unit,
  locations,
  canCount,
  archived,
}: {
  productId: string
  unit: string
  locations: Loc[]
  canCount: boolean
  archived: boolean
}) {
  const tabs = TABS.filter(
    (t) => (t.id !== "count" || canCount) && (!archived || t.id === "issue" || t.id === "count"),
  )
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>(tabs[0]?.id ?? "issue")
  const [done, setDone] = useState<string | null>(null)
  const { pending, submit, errors, formError, reset } = useInventoryAction()
  const [key, setKey] = useState(0)
  const active = locations.filter((l) => l.active)
  const withStock = locations.filter((l) => l.quantityMilli > 0)
  const label = (l: Loc) => `${l.name} (${formatQuantity(l.quantityMilli, unit)})`

  if (locations.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        Add a{" "}
        <a href="/inventory/locations" className="underline">
          location
        </a>{" "}
        first.
      </p>
    )

  const ok = (msg: string) => () => {
    setDone(msg)
    setKey((k) => k + 1)
  }
  const locSelect = (name: string, labelText: string, list: Loc[], error?: string) => (
    <Choice label={labelText} name={name} error={error} defaultValue={list[0]?.id}>
      {list.map((l) => (
        <option key={l.id} value={l.id}>
          {label(l)}
        </option>
      ))}
    </Choice>
  )

  return (
    <div className="grid gap-4">
      <div role="tablist" aria-label="Stock action" className="flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => {
              setTab(t.id)
              setDone(null)
              reset()
            }}
            className={cn(
              "h-8 rounded-full border px-3 text-sm",
              tab === t.id
                ? "border-foreground bg-accent font-medium"
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <form
        key={`${tab}-${key}`}
        noValidate
        className="grid gap-3"
        onChange={() => setDone(null)}
        onSubmit={(e) => {
          e.preventDefault()
          const v = values<Record<string, string>>(e.currentTarget)
          if (tab === "receive")
            submit(
              () => receiveAction(productId, v as ReceiveInput),
              ok(`Received ${v.quantity} ${unit}.`),
            )
          if (tab === "issue")
            submit(
              () => issueAction(productId, v as unknown as IssueInput),
              ok(`Issued ${v.quantity} ${unit}.`),
            )
          if (tab === "transfer")
            submit(
              () => transferAction(productId, v as TransferInput),
              ok(`Moved ${v.quantity} ${unit}.`),
            )
          if (tab === "count")
            submit(
              () =>
                countAction(productId, {
                  locationId: v.locationId ?? "",
                  counted: v.counted,
                  note: v.note,
                }),
              ok("Count saved."),
            )
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {tab === "receive" && (
            <>
              {locSelect("locationId", "Into", active, errors.locationId)}
              <Input
                label={`Quantity (${unit})`}
                name="quantity"
                inputMode="decimal"
                error={errors.quantity}
              />
              <Input
                label="Cost per unit"
                name="unitCost"
                inputMode="decimal"
                placeholder="Optional"
                error={errors.unitCost}
              />
              <Input
                label="Reference"
                name="reference"
                placeholder="PO or delivery note"
                maxLength={100}
                error={errors.reference}
              />
            </>
          )}
          {tab === "issue" &&
            (withStock.length === 0 ? (
              <p className="text-sm text-muted-foreground sm:col-span-2">
                Nothing on hand to issue.
              </p>
            ) : (
              <>
                {locSelect("locationId", "From", withStock, errors.locationId)}
                <Input
                  label={`Quantity (${unit})`}
                  name="quantity"
                  inputMode="decimal"
                  error={errors.quantity}
                />
                <Choice label="Reason" name="reason" defaultValue="sold" error={errors.reason}>
                  {ISSUE_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {REASON_LABELS[r]}
                    </option>
                  ))}
                </Choice>
                <Input
                  label="Reference"
                  name="reference"
                  placeholder="Order or invoice number"
                  maxLength={100}
                  error={errors.reference}
                />
              </>
            ))}
          {tab === "transfer" &&
            (withStock.length === 0 || active.length < 2 ? (
              <p className="text-sm text-muted-foreground sm:col-span-2">
                {withStock.length === 0
                  ? "Nothing on hand to move."
                  : "Add a second location to transfer between."}
              </p>
            ) : (
              <>
                {locSelect("fromLocationId", "From", withStock, errors.fromLocationId)}
                <Choice
                  label="To"
                  name="toLocationId"
                  error={errors.toLocationId}
                  defaultValue={active.find((l) => l.id !== withStock[0]?.id)?.id}
                >
                  {active.map((l) => (
                    <option key={l.id} value={l.id}>
                      {label(l)}
                    </option>
                  ))}
                </Choice>
                <Input
                  label={`Quantity (${unit})`}
                  name="quantity"
                  inputMode="decimal"
                  error={errors.quantity}
                />
              </>
            ))}
          {tab === "count" && (
            <>
              {locSelect("locationId", "Location", locations, errors.locationId)}
              <Input
                label={`Counted (${unit})`}
                name="counted"
                inputMode="decimal"
                error={errors.counted}
                hint="What's actually there. The difference is recorded."
              />
            </>
          )}
          <Input
            label="Note"
            name="note"
            maxLength={500}
            placeholder="Optional"
            error={errors.note}
            className="sm:col-span-2"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={pending}>
            {pending ? "Saving…" : TABS.find((t) => t.id === tab)?.label}
          </Button>
          {done && <span className="text-sm text-success">{done}</span>}
          <ErrorText>{formError}</ErrorText>
        </div>
      </form>
    </div>
  )
}

// ---------- Locations ----------

export function LocationEditor({
  location,
}: {
  location?: { id: string; name: string; address: string | null; status: string }
}) {
  const [open, setOpen] = useState(false)
  const { pending, submit, errors, formError, reset } = useInventoryAction()
  const router = useRouter()
  const [busy, start] = useTransition()
  if (!open)
    return location ? (
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
              const r = await setLocationStatusAction(location.id, location.status === "active")
              if (!r.ok) alert(r.error)
              router.refresh()
            })
          }
        >
          {location.status === "active" ? "Archive" : "Restore"}
        </Button>
      </div>
    ) : (
      <Button onClick={() => setOpen(true)}>
        <Plus /> New location
      </Button>
    )
  return (
    <form
      noValidate
      className="grid w-full gap-3 rounded-xl border p-4 sm:max-w-md"
      onSubmit={(e) => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        submit(
          () =>
            saveLocationAction(location?.id ?? null, {
              name: String(f.get("name") ?? ""),
              address: String(f.get("address") ?? ""),
            }),
          () => setOpen(false),
        )
      }}
    >
      <Input
        label="Name"
        name="name"
        defaultValue={location?.name}
        autoFocus
        maxLength={80}
        error={errors.name}
      />
      <Input
        label="Address"
        name="address"
        defaultValue={location?.address ?? ""}
        maxLength={500}
        error={errors.address}
      />
      <ErrorText>{formError}</ErrorText>
      <div className="flex gap-2">
        <Button disabled={pending}>
          {pending ? "Saving…" : location ? "Save" : "Add location"}
        </Button>
        <Button
          type="button"
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
