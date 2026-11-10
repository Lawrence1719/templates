"use client"

import { answerSchema, type Field, fieldErrors } from "@templates/forms/definitions"
import { Button } from "@templates/ui/button"
import { cn } from "@templates/ui/cn"
import { useState } from "react"

type Props = {
  fields: Field[]
  /** Called with validated answers. Return field errors from the server, if any. */
  onSubmit?: (
    answers: Record<string, unknown>,
    honeypot: string,
  ) => Promise<Record<string, string> | undefined>
  submitLabel?: string
  preview?: boolean
}

const control =
  "w-full rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-danger"

/** Renders a form from its field definitions, validating in the browser before submitting. */
export function FormRenderer({ fields, onSubmit, submitLabel = "Submit", preview }: Props) {
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)

  async function handle(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (preview || !onSubmit) return
    const fd = new FormData(e.currentTarget)
    const answers: Record<string, unknown> = {}
    for (const f of fields) {
      if (f.type === "multi_select") answers[f.id] = fd.getAll(f.id).map(String)
      else if (f.type === "checkbox") answers[f.id] = fd.get(f.id) === "on"
      else answers[f.id] = String(fd.get(f.id) ?? "")
    }
    const parsed = answerSchema(fields).safeParse(answers)
    if (!parsed.success) {
      const errs = fieldErrors(parsed.error)
      setErrors(errs)
      document.getElementById(`field-${Object.keys(errs)[0]}`)?.focus()
      return
    }
    setErrors({})
    setPending(true)
    const serverErrors = await onSubmit(answers, String(fd.get("website") ?? ""))
    setPending(false)
    if (serverErrors) setErrors(serverErrors)
  }

  return (
    <form onSubmit={handle} noValidate className="grid gap-5">
      {/* Honeypot: hidden from people and screen readers; bots fill it in. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      {fields.map((f) => (
        <FieldInput key={f.id} field={f} error={errors[f.id]} />
      ))}
      {errors._form && (
        <p role="alert" className="text-sm text-danger">
          {errors._form}
        </p>
      )}
      <div>
        <Button disabled={pending || preview}>{pending ? "Sending…" : submitLabel}</Button>
      </div>
    </form>
  )
}

function FieldInput({ field: f, error }: { field: Field; error?: string }) {
  const id = `field-${f.id}`
  const describedBy =
    [f.help && `${id}-help`, error && `${id}-error`].filter(Boolean).join(" ") || undefined
  const common = {
    id,
    name: f.id,
    "aria-invalid": !!error,
    "aria-describedby": describedBy,
    required: f.required,
  }
  const label = (
    <span className="text-sm font-medium">
      {f.label}
      {f.required && <span className="text-danger"> *</span>}
    </span>
  )
  const meta = (
    <>
      {f.help && (
        <span id={`${id}-help`} className="text-xs text-muted-foreground">
          {f.help}
        </span>
      )}
      {error && (
        <span id={`${id}-error`} role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </>
  )

  if (f.type === "checkbox")
    return (
      <div className="grid gap-1">
        <label className="flex items-start gap-2.5">
          <input type="checkbox" {...common} className="mt-0.5 size-4 accent-[var(--chart-1)]" />
          {label}
        </label>
        {meta}
      </div>
    )

  if (f.type === "multi_select")
    return (
      <fieldset className="grid gap-1.5" aria-describedby={describedBy}>
        <legend className="mb-1.5">{label}</legend>
        {(f.options ?? []).map((o, i) => (
          <label key={o} className="flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              name={f.id}
              value={o}
              id={i === 0 ? id : undefined}
              className="size-4 accent-[var(--chart-1)]"
            />
            {o}
          </label>
        ))}
        {meta}
      </fieldset>
    )

  return (
    <label className="grid gap-1.5">
      {label}
      {f.type === "long_text" ? (
        <textarea
          {...common}
          rows={4}
          placeholder={f.placeholder}
          className={cn(control, "py-2")}
        />
      ) : f.type === "select" ? (
        <select {...common} defaultValue="" className={cn(control, "h-9 px-2")}>
          <option value="" disabled={f.required}>
            {f.placeholder || "Choose…"}
          </option>
          {(f.options ?? []).map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      ) : (
        <input
          {...common}
          type={
            { email: "email", phone: "tel", number: "number", date: "date" }[f.type as string] ??
            "text"
          }
          inputMode={f.type === "number" ? "decimal" : undefined}
          min={f.min}
          max={f.max}
          placeholder={f.placeholder}
          autoComplete={f.type === "email" ? "email" : f.type === "phone" ? "tel" : undefined}
          className={cn(control, "h-9")}
        />
      )}
      {meta}
    </label>
  )
}
