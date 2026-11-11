"use client"

import { cn } from "@templates/ui/cn"
import { Select } from "@templates/ui/form"
import { type ReactNode, useId } from "react"

/** Labeled inputs with inline errors, shared by the module forms. */
export const control =
  "w-full rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-danger"

/** Runs a server action, keeps field errors, and refreshes the page on success. */

export function Labeled({
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

export function Input({
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

export function Choice({
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
