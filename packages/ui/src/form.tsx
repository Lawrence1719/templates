import type { ComponentProps } from "react"

import { cn } from "./cn"

const control =
  "h-9 rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"

export function Field({
  label,
  hint,
  className,
  ...props
}: ComponentProps<"input"> & { label: string; hint?: string }) {
  return (
    <label className={cn("grid gap-1.5 text-sm", className)}>
      <span className="font-medium">{label}</span>
      <input className={control} {...props} />
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(control, "px-2", className)} {...props} />
}

export function ErrorText({ children }: { children?: string | null }) {
  if (!children) return null
  return (
    <p role="alert" className="text-sm text-danger">
      {children}
    </p>
  )
}
