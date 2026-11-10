"use client"

import {
  FIELD_TYPES,
  type Field,
  type FieldType,
  type FormSettings,
  fieldIdFrom,
} from "@templates/forms/definitions"
import { Button } from "@templates/ui/button"
import { Card } from "@templates/ui/card"
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from "@templates/ui/dropdown"
import { Select, Field as TextField } from "@templates/ui/form"
import { ArrowDown, ArrowUp, Check, Copy, ExternalLink, Plus, Trash2 } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { deleteFormAction, saveFormAction, setFormStatusAction } from "@/app/actions/forms"

import { FormRenderer } from "./form-renderer"

type Settings = Omit<FormSettings, "description" | "confirmation"> & {
  description: string
  confirmation: string
}

export function FormBuilder({
  id,
  status,
  shareUrl,
  initial,
}: {
  id: string
  status: "draft" | "published" | "closed"
  shareUrl: string
  initial: Settings
}) {
  const router = useRouter()
  const [s, setS] = useState(initial)
  const [dirty, setDirty] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [pending, start] = useTransition()

  const set = (patch: Partial<Settings>) => {
    setS((x) => ({ ...x, ...patch }))
    setDirty(true)
    setMessage(null)
  }
  const setField = (i: number, patch: Partial<Field>) =>
    set({ fields: s.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) })
  const move = (i: number, by: number) => {
    const next = [...s.fields]
    const [f] = next.splice(i, 1)
    if (f) next.splice(i + by, 0, f)
    set({ fields: next })
  }
  const add = (type: FieldType) => {
    const label = FIELD_TYPES[type].label
    const f: Field = {
      id: fieldIdFrom(label, new Set(s.fields.map((x) => x.id))),
      type,
      label,
      required: false,
      ...(FIELD_TYPES[type].hasOptions ? { options: ["Option 1", "Option 2"] } : {}),
    }
    set({ fields: [...s.fields, f] })
  }

  const save = () =>
    new Promise<boolean>((resolve) =>
      start(async () => {
        const r = await saveFormAction(id, s)
        if (r.ok) {
          setErrors({})
          setDirty(false)
          setMessage("Saved")
          router.refresh()
        } else {
          setErrors(r.fieldErrors ?? {})
          setMessage(r.error)
        }
        resolve(r.ok)
      }),
    )

  const changeStatus = (next: "draft" | "published" | "closed") =>
    start(async () => {
      if (dirty && !(await save())) return
      const r = await setFormStatusAction(id, next)
      setMessage(
        r.ok
          ? next === "published"
            ? "Published"
            : next === "closed"
              ? "Closed"
              : "Unpublished"
          : r.error,
      )
      router.refresh()
    })

  const err = (path: string) => errors[path]

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/forms" className="text-sm text-muted-foreground hover:text-foreground">
            ← Forms
          </Link>
          <span className="rounded-full border px-2 py-0.5 text-xs capitalize">{status}</span>
          {message && (
            <span
              role="status"
              className={
                errors && Object.keys(errors).length
                  ? "text-sm text-danger"
                  : "text-sm text-muted-foreground"
              }
            >
              {message}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/forms/${id}/responses`}
            className="inline-flex h-9 items-center rounded-md border px-3 text-sm hover:bg-accent"
          >
            Responses
          </Link>
          <Button variant="ghost" disabled={pending || !dirty} onClick={save}>
            Save
          </Button>
          {status === "published" ? (
            <Button variant="ghost" disabled={pending} onClick={() => changeStatus("closed")}>
              Close form
            </Button>
          ) : (
            <Button disabled={pending} onClick={() => changeStatus("published")}>
              {status === "closed" ? "Reopen" : "Publish"}
            </Button>
          )}
        </div>
      </div>

      {status !== "draft" && (
        <Card className="flex flex-wrap items-center gap-2 py-3">
          <span className="text-sm text-muted-foreground">Share link</span>
          <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs">
            {shareUrl}
          </code>
          <Button
            variant="quiet"
            size="sm"
            onClick={async () => {
              await navigator.clipboard.writeText(shareUrl)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
          >
            {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
          </Button>
          <a
            href={shareUrl}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            Open <ExternalLink className="size-3.5" />
          </a>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="grid content-start gap-4">
          <Card className="grid gap-4">
            <TextField
              label="Title"
              value={s.title}
              onChange={(e) => set({ title: e.target.value })}
              maxLength={200}
            />
            {err("title") && <p className="-mt-2 text-xs text-danger">{err("title")}</p>}
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">Description</span>
              <textarea
                rows={2}
                value={s.description}
                onChange={(e) => set({ description: e.target.value })}
                maxLength={2000}
                className="rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">Who can respond</span>
              <Select
                value={s.visibility}
                onChange={(e) => set({ visibility: e.target.value as Settings["visibility"] })}
              >
                <option value="public">Anyone with the link</option>
                <option value="members">Signed-in members of this organization</option>
              </Select>
            </label>
            <TextField
              label="Message after submitting"
              placeholder="Thanks! We'll be in touch."
              value={s.confirmation}
              onChange={(e) => set({ confirmation: e.target.value })}
              maxLength={1000}
            />
          </Card>

          {s.fields.map((f, i) => (
            <Card key={`${f.id}-${i}`} className="grid gap-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {FIELD_TYPES[f.type].label}
                </span>
                <div className="flex">
                  <Button
                    variant="quiet"
                    size="icon"
                    aria-label="Move up"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="quiet"
                    size="icon"
                    aria-label="Move down"
                    disabled={i === s.fields.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    variant="danger"
                    size="icon"
                    aria-label={`Remove ${f.label}`}
                    onClick={() => set({ fields: s.fields.filter((_, j) => j !== i) })}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
              <TextField
                label="Question"
                value={f.label}
                onChange={(e) => setField(i, { label: e.target.value })}
                maxLength={200}
              />
              {err(`fields.${i}.label`) && (
                <p className="-mt-2 text-xs text-danger">{err(`fields.${i}.label`)}</p>
              )}
              <TextField
                label="Help text"
                value={f.help ?? ""}
                onChange={(e) => setField(i, { help: e.target.value || undefined })}
                maxLength={500}
              />
              {FIELD_TYPES[f.type].hasOptions && (
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium">Options (one per line)</span>
                  <textarea
                    rows={Math.min(8, (f.options?.length ?? 1) + 1)}
                    value={(f.options ?? []).join("\n")}
                    onChange={(e) => setField(i, { options: e.target.value.split("\n") })}
                    onBlur={(e) =>
                      setField(i, {
                        options: e.target.value
                          .split("\n")
                          .map((o) => o.trim())
                          .filter(Boolean),
                      })
                    }
                    className="rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  {err(`fields.${i}.options`) && (
                    <span className="text-xs text-danger">{err(`fields.${i}.options`)}</span>
                  )}
                </label>
              )}
              {f.type === "number" && (
                <div className="grid grid-cols-2 gap-3">
                  <TextField
                    label="Minimum"
                    type="number"
                    value={f.min ?? ""}
                    onChange={(e) =>
                      setField(i, {
                        min: e.target.value === "" ? undefined : Number(e.target.value),
                      })
                    }
                  />
                  <TextField
                    label="Maximum"
                    type="number"
                    value={f.max ?? ""}
                    onChange={(e) =>
                      setField(i, {
                        max: e.target.value === "" ? undefined : Number(e.target.value),
                      })
                    }
                  />
                </div>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={f.required}
                  onChange={(e) => setField(i, { required: e.target.checked })}
                  className="size-4 accent-[var(--chart-1)]"
                />
                Required
              </label>
            </Card>
          ))}
          {err("fields") && <p className="text-sm text-danger">{err("fields")}</p>}

          <Dropdown>
            <DropdownTrigger asChild>
              <Button variant="ghost" className="w-full" disabled={s.fields.length >= 50}>
                <Plus /> Add field
              </Button>
            </DropdownTrigger>
            <DropdownContent align="start" className="w-56">
              {(Object.keys(FIELD_TYPES) as FieldType[]).map((t) => (
                <DropdownItem key={t} onSelect={() => add(t)}>
                  {FIELD_TYPES[t].label}
                </DropdownItem>
              ))}
            </DropdownContent>
          </Dropdown>

          <Button
            variant="danger"
            className="justify-self-start"
            disabled={pending}
            onClick={() => {
              if (confirm("Delete this form and all its responses? This can't be undone."))
                start(() => deleteFormAction(id))
            }}
          >
            <Trash2 /> Delete form
          </Button>
        </div>

        <div className="lg:sticky lg:top-20 lg:self-start">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Preview</p>
          <Card className="grid gap-5">
            <div>
              <h2 className="text-xl font-semibold">{s.title || "Untitled form"}</h2>
              {s.description && (
                <p className="mt-1 text-sm whitespace-pre-line text-muted-foreground">
                  {s.description}
                </p>
              )}
            </div>
            <FormRenderer fields={s.fields.filter((f) => f.label.trim())} preview />
          </Card>
        </div>
      </div>
    </div>
  )
}
