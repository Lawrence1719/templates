import type { ComponentProps } from "react"

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ")

export function Button({
  variant = "primary",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: "primary" | "ghost" | "danger" }) {
  return (
    <button
      className={cx(
        "inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
        variant === "primary" &&
          "bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200",
        variant === "ghost" &&
          "border border-neutral-200 hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-900",
        variant === "danger" && "text-red-600 hover:bg-red-50 dark:hover:bg-red-950",
        className,
      )}
      {...props}
    />
  )
}

export function Field({ label, ...props }: ComponentProps<"input"> & { label: string }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <input
        className="h-9 rounded-md border border-neutral-200 bg-transparent px-3 outline-none focus:ring-2 focus:ring-neutral-400 dark:border-neutral-800"
        {...props}
      />
    </label>
  )
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cx("rounded-xl border border-neutral-200 p-6 dark:border-neutral-800", className)}
      {...props}
    />
  )
}

export function ErrorText({ children }: { children?: string | null }) {
  if (!children) return null
  return (
    <p role="alert" className="text-sm text-red-600">
      {children}
    </p>
  )
}
