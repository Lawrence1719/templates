"use client"

import {
  ACTIVITY_KINDS,
  ACTIVITY_LABELS,
  CURRENCIES,
  CUSTOMER_STATUSES,
  DEAL_STAGES,
  type DealInput,
  STAGE_LABELS,
  STATUS_LABELS,
} from "@templates/crm/definitions"
import { Button } from "@templates/ui/button"
import { cn } from "@templates/ui/cn"
import { ErrorText, Select } from "@templates/ui/form"
import { Dialog, DialogContent } from "@templates/ui/sheet"
import { Pencil, Plus, Trash2, X } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { type ReactNode, useId, useState, useTransition } from "react"

import {
  addContactAction,
  type CrmResult,
  createCustomerAction,
  createDealAction,
  deleteActivityAction,
  deleteContactAction,
  deleteCustomerAction,
  deleteDealAction,
  logActivityAction,
  moveDealAction,
  updateContactAction,
  updateCustomerAction,
  updateDealAction,
} from "@/app/actions/crm"

type Member = { id: string; name: string; email: string }

const control =
  "w-full rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-danger"

/** Runs a server action, keeps field errors, and refreshes the page on success. */
function useCrmAction() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [result, setResult] = useState<CrmResult | null>(null)
  const submit = (fn: () => Promise<CrmResult>, onOk?: (r: CrmResult & { ok: true }) => void) =>
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

const values = (form: HTMLFormElement) =>
  Object.fromEntries(new FormData(form)) as Record<string, string>

function Labeled({
  label,
  error,
  hint,
  className,
  children,
}: {
  label: string
  error?: string
  hint?: string
  className?: string
  children: (id: string, describedBy?: string) => ReactNode
}) {
  const id = useId()
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined
  return (
    <div className={cn("grid content-start gap-1.5 text-sm", className)}>
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      {children(id, describedBy)}
      {error ? (
        <span id={`${id}-err`} className="text-xs text-danger">
          {error}
        </span>
      ) : (
        hint && (
          <span id={`${id}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </span>
        )
      )}
    </div>
  )
}

function Input({
  label,
  error,
  hint,
  className,
  ...props
}: React.ComponentProps<"input"> & { label: string; error?: string; hint?: string }) {
  return (
    <Labeled label={label} error={error} hint={hint} className={className}>
      {(id, d) => (
        <input
          id={id}
          aria-invalid={!!error || undefined}
          aria-describedby={d}
          className={cn(control, "h-9")}
          {...props}
        />
      )}
    </Labeled>
  )
}

function Choice({
  label,
  error,
  className,
  children,
  ...props
}: React.ComponentProps<"select"> & { label: string; error?: string }) {
  return (
    <Labeled label={label} error={error} className={className}>
      {(id, d) => (
        <Select
          id={id}
          aria-invalid={!!error || undefined}
          aria-describedby={d}
          className="w-full"
          {...props}
        >
          {children}
        </Select>
      )}
    </Labeled>
  )
}

function OwnerOptions({ members }: { members: Member[] }) {
  return (
    <>
      <option value="">No owner</option>
      {members.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </>
  )
}

// ---------- Customer ----------

export type CustomerFormValues = {
  kind: "company" | "person"
  name: string
  email: string
  phone: string
  website: string
  address: string
  status: "lead" | "active" | "inactive"
  ownerId: string
  tags: string
}

export function CustomerForm({
  id,
  initial,
  members,
}: {
  id?: string
  initial: CustomerFormValues
  members: Member[]
}) {
  const router = useRouter()
  const { pending, submit, errors, formError } = useCrmAction()
  return (
    <form
      noValidate
      className="grid gap-5 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault()
        const v = values(e.currentTarget) as CustomerFormValues
        submit(
          () => (id ? updateCustomerAction(id, v) : createCustomerAction(v)),
          (r) => router.push(`/customers/${id ?? r.id}`),
        )
      }}
    >
      <fieldset className="grid gap-1.5 text-sm sm:col-span-2">
        <legend className="mb-1.5 font-medium">Type</legend>
        <div className="flex gap-2">
          {(["company", "person"] as const).map((k) => (
            <label
              key={k}
              className="flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 has-checked:border-foreground has-checked:bg-accent"
            >
              <input
                type="radio"
                name="kind"
                value={k}
                defaultChecked={initial.kind === k}
                className="accent-current"
              />
              {k === "company" ? "Company" : "Person"}
            </label>
          ))}
        </div>
      </fieldset>
      <Input
        label="Name"
        name="name"
        defaultValue={initial.name}
        required
        maxLength={120}
        error={errors.name}
        className="sm:col-span-2"
        autoFocus={!id}
      />
      <Input
        label="Email"
        name="email"
        type="email"
        defaultValue={initial.email}
        error={errors.email}
      />
      <Input
        label="Phone"
        name="phone"
        type="tel"
        defaultValue={initial.phone}
        error={errors.phone}
      />
      <Input
        label="Website"
        name="website"
        defaultValue={initial.website}
        placeholder="example.com"
        error={errors.website}
      />
      <Choice label="Status" name="status" defaultValue={initial.status} error={errors.status}>
        {CUSTOMER_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABELS[s]}
          </option>
        ))}
      </Choice>
      <Choice label="Owner" name="ownerId" defaultValue={initial.ownerId} error={errors.ownerId}>
        <OwnerOptions members={members} />
      </Choice>
      <Input
        label="Tags"
        name="tags"
        defaultValue={initial.tags}
        placeholder="vip, wholesale"
        hint="Separate with commas."
        error={errors.tags}
      />
      <Labeled label="Address" error={errors.address} className="sm:col-span-2">
        {(fid, d) => (
          <textarea
            id={fid}
            name="address"
            rows={3}
            maxLength={500}
            defaultValue={initial.address}
            aria-describedby={d}
            className={cn(control, "py-2")}
          />
        )}
      </Labeled>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button disabled={pending}>
          {pending ? "Saving…" : id ? "Save changes" : "Add customer"}
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

export function DeleteCustomerButton({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition()
  return (
    <Button
      variant="danger"
      disabled={pending}
      onClick={() => {
        if (
          !confirm(
            `Delete ${name}? Their contacts, deals and timeline go too. This can't be undone.`,
          )
        )
          return
        start(async () => {
          const r = await deleteCustomerAction(id)
          if (r && !r.ok) alert(r.error)
        })
      }}
    >
      <Trash2 /> Delete
    </Button>
  )
}

/** Filters live in the URL so a filtered list can be bookmarked or shared. */
export function CustomerFilters({ tags }: { tags: string[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const active = ["q", "status", "owner", "tag"].some((k) => params.get(k))
  return (
    <form
      role="search"
      className="flex flex-wrap gap-2 [&>*]:min-w-0"
      onSubmit={(e) => {
        e.preventDefault()
        const p = new URLSearchParams()
        for (const [k, v] of new FormData(e.currentTarget)) if (v) p.set(k, String(v))
        router.push(`${pathname}${p.size ? `?${p}` : ""}`)
      }}
    >
      <input
        name="q"
        type="search"
        aria-label="Search customers"
        placeholder="Search name, email, phone or contact…"
        defaultValue={params.get("q") ?? ""}
        className={cn(control, "h-9 basis-full sm:basis-64 sm:grow")}
      />
      <Select
        name="status"
        aria-label="Status"
        className="flex-1 sm:flex-none"
        defaultValue={params.get("status") ?? ""}
      >
        <option value="">Any status</option>
        {CUSTOMER_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABELS[s]}
          </option>
        ))}
      </Select>
      <Select
        name="owner"
        aria-label="Owner"
        className="flex-1 sm:flex-none"
        defaultValue={params.get("owner") ?? ""}
      >
        <option value="">Anyone's</option>
        <option value="me">Mine</option>
        <option value="none">No owner</option>
      </Select>
      {tags.length > 0 && (
        <Select
          name="tag"
          aria-label="Tag"
          className="flex-1 sm:flex-none"
          defaultValue={params.get("tag") ?? ""}
        >
          <option value="">Any tag</option>
          {tags.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </Select>
      )}
      <div className="flex gap-2">
        <Button variant="ghost">Filter</Button>
        {active && (
          <Button type="button" variant="quiet" onClick={() => router.push(pathname)}>
            Clear
          </Button>
        )}
      </div>
    </form>
  )
}

// ---------- Contacts ----------

type Contact = {
  id: string
  name: string
  title: string | null
  email: string | null
  phone: string | null
  isPrimary: boolean
}

function ContactFields({ initial, errors }: { initial?: Contact; errors: Record<string, string> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Input label="Name" name="name" defaultValue={initial?.name} error={errors.name} autoFocus />
      <Input
        label="Job title"
        name="title"
        defaultValue={initial?.title ?? ""}
        error={errors.title}
      />
      <Input
        label="Email"
        name="email"
        type="email"
        defaultValue={initial?.email ?? ""}
        error={errors.email}
      />
      <Input
        label="Phone"
        name="phone"
        type="tel"
        defaultValue={initial?.phone ?? ""}
        error={errors.phone}
      />
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="isPrimary" defaultChecked={initial?.isPrimary} />
        Main contact
      </label>
    </div>
  )
}

export function ContactEditor({
  customerId,
  contact,
  canEdit,
}: {
  customerId: string
  contact?: Contact
  canEdit: boolean
}) {
  const [open, setOpen] = useState(false)
  const { pending, submit, errors, formError, reset } = useCrmAction()
  const [deleting, startDelete] = useTransition()
  const router = useRouter()

  if (!open) {
    if (!contact)
      return canEdit ? (
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          <Plus /> Add contact
        </Button>
      ) : null
    return (
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium">
            {contact.name}
            {contact.isPrimary && (
              <span className="ml-2 rounded-full border px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">
                Main
              </span>
            )}
          </p>
          {contact.title && <p className="text-xs text-muted-foreground">{contact.title}</p>}
          <p className="flex flex-wrap gap-x-3 text-xs">
            {contact.email && (
              <a className="hover:underline" href={`mailto:${contact.email}`}>
                {contact.email}
              </a>
            )}
            {contact.phone && (
              <a className="hover:underline" href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}>
                {contact.phone}
              </a>
            )}
          </p>
        </div>
        {canEdit && (
          <>
            <Button
              variant="quiet"
              size="icon"
              className="size-7"
              aria-label={`Edit ${contact.name}`}
              onClick={() => setOpen(true)}
            >
              <Pencil />
            </Button>
            <Button
              variant="danger"
              size="icon"
              className="size-7"
              aria-label={`Remove ${contact.name}`}
              disabled={deleting}
              onClick={() => {
                if (!confirm(`Remove ${contact.name}?`)) return
                startDelete(async () => {
                  const r = await deleteContactAction(contact.id)
                  if (!r.ok) alert(r.error)
                  router.refresh()
                })
              }}
            >
              <Trash2 />
            </Button>
          </>
        )}
      </div>
    )
  }

  const close = () => {
    reset()
    setOpen(false)
  }
  return (
    <form
      noValidate
      className="grid gap-3 rounded-lg border p-3"
      onSubmit={(e) => {
        e.preventDefault()
        const v = values(e.currentTarget)
        submit(
          () => (contact ? updateContactAction(contact.id, v) : addContactAction(customerId, v)),
          close,
        )
      }}
    >
      <ContactFields initial={contact} errors={errors} />
      <ErrorText>{formError}</ErrorText>
      <div className="flex gap-2">
        <Button size="sm" disabled={pending}>
          {pending ? "Saving…" : contact ? "Save" : "Add"}
        </Button>
        <Button type="button" size="sm" variant="quiet" onClick={close}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

// ---------- Timeline ----------

export function ActivityComposer({ customerId }: { customerId: string }) {
  const { pending, submit, errors, formError } = useCrmAction()
  const [kind, setKind] = useState<(typeof ACTIVITY_KINDS)[number]>("note")
  const [key, setKey] = useState(0)
  return (
    <form
      key={key}
      noValidate
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        const v = { ...values(e.currentTarget), kind }
        submit(
          () => logActivityAction(customerId, v),
          () => setKey((k) => k + 1),
        )
      }}
    >
      <div role="radiogroup" aria-label="What happened" className="flex flex-wrap gap-1.5">
        {ACTIVITY_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => setKind(k)}
            className={cn(
              "h-8 rounded-full border px-3 text-sm",
              kind === k
                ? "border-foreground bg-accent font-medium"
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            {ACTIVITY_LABELS[k]}
          </button>
        ))}
      </div>
      <textarea
        name="body"
        rows={3}
        maxLength={5000}
        aria-label="What happened"
        aria-invalid={!!errors.body || undefined}
        placeholder={
          kind === "call"
            ? "Who you spoke to and what was agreed…"
            : kind === "meeting"
              ? "Who attended and the outcome…"
              : kind === "email"
                ? "What was sent or received…"
                : "Write a note…"
        }
        className={cn(control, "py-2")}
      />
      {errors.body && <span className="text-xs text-danger">{errors.body}</span>}
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs text-muted-foreground">
          When (leave empty for now)
          <input
            type="datetime-local"
            name="occurredAt"
            aria-invalid={!!errors.occurredAt || undefined}
            className={cn(control, "h-9 w-auto text-foreground")}
          />
        </label>
        <Button disabled={pending}>
          {pending ? "Saving…" : `Log ${ACTIVITY_LABELS[kind].toLowerCase()}`}
        </Button>
        {errors.occurredAt && <span className="text-xs text-danger">{errors.occurredAt}</span>}
        <ErrorText>{formError}</ErrorText>
      </div>
    </form>
  )
}

export function DeleteActivityButton({ id }: { id: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <Button
      variant="quiet"
      size="icon"
      className="size-7 text-muted-foreground"
      aria-label="Delete entry"
      disabled={pending}
      onClick={() => {
        if (!confirm("Delete this entry from the timeline?")) return
        start(async () => {
          const r = await deleteActivityAction(id)
          if (!r.ok) alert(r.error)
          router.refresh()
        })
      }}
    >
      <X />
    </Button>
  )
}

// ---------- Deals ----------

export type DealFormValues = {
  id?: string
  title: string
  value: string
  currency: string
  stage: string
  ownerId: string
  expectedCloseOn: string
}

export function DealDialog({
  customerId,
  members,
  initial,
  canDelete,
  trigger,
}: {
  customerId: string
  members: Member[]
  initial: DealFormValues
  canDelete?: boolean
  trigger: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const { pending, submit, errors, formError, reset } = useCrmAction()
  const [deleting, startDelete] = useTransition()
  const router = useRouter()
  const editing = !!initial.id

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <span onClickCapture={() => setOpen(true)} className="contents">
        {trigger}
      </span>
      <DialogContent title={editing ? "Edit deal" : "New deal"} className="top-[10vh]">
        <form
          noValidate
          className="grid gap-4 p-5"
          onSubmit={(e) => {
            e.preventDefault()
            // The server re-validates every field; this cast only satisfies the action's input type.
            const v = values(e.currentTarget) as DealInput
            submit(
              () =>
                initial.id ? updateDealAction(initial.id, v) : createDealAction(customerId, v),
              () => setOpen(false),
            )
          }}
        >
          <h2 className="text-base font-semibold">{editing ? "Edit deal" : "New deal"}</h2>
          <Input
            label="Deal"
            name="title"
            defaultValue={initial.title}
            placeholder="Annual plan, website redesign…"
            error={errors.title}
            autoFocus
          />
          <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
            <Input
              label="Value"
              name="value"
              inputMode="decimal"
              defaultValue={initial.value}
              placeholder="0.00"
              error={errors.value}
            />
            <Choice label="Currency" name="currency" defaultValue={initial.currency}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Choice>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Choice label="Stage" name="stage" defaultValue={initial.stage} error={errors.stage}>
              {DEAL_STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABELS[s]}
                </option>
              ))}
            </Choice>
            <Input
              label="Expected close"
              name="expectedCloseOn"
              type="date"
              defaultValue={initial.expectedCloseOn}
              error={errors.expectedCloseOn}
            />
          </div>
          <Choice
            label="Owner"
            name="ownerId"
            defaultValue={initial.ownerId}
            error={errors.ownerId}
          >
            <OwnerOptions members={members} />
          </Choice>
          <ErrorText>{formError}</ErrorText>
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={pending}>
              {pending ? "Saving…" : editing ? "Save" : "Add deal"}
            </Button>
            <Button type="button" variant="quiet" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            {editing && canDelete && (
              <Button
                type="button"
                variant="danger"
                className="ml-auto"
                disabled={deleting}
                onClick={() => {
                  if (!confirm(`Delete the deal "${initial.title}"?`)) return
                  startDelete(async () => {
                    const r = await deleteDealAction(initial.id ?? "")
                    if (!r.ok) return alert(r.error)
                    setOpen(false)
                    router.refresh()
                  })
                }}
              >
                <Trash2 /> Delete
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Moves a deal between stages: the pipeline board's main control, keyboard friendly. */
export function StageSelect({
  id,
  stage,
  title,
  disabled,
}: {
  id: string
  stage: string
  title: string
  disabled?: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <Select
      aria-label={`Stage for ${title}`}
      value={stage}
      disabled={disabled || pending}
      className="h-8 text-xs"
      onChange={(e) => {
        const next = e.target.value
        start(async () => {
          const r = await moveDealAction(id, next)
          if (!r.ok) alert(r.error)
          router.refresh()
        })
      }}
    >
      {DEAL_STAGES.map((s) => (
        <option key={s} value={s}>
          {STAGE_LABELS[s]}
        </option>
      ))}
    </Select>
  )
}
