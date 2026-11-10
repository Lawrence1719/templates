import type { ComponentProps } from "react"

import { cn } from "./cn"

const variants = {
  primary: "bg-primary text-primary-foreground hover:opacity-90",
  ghost: "border hover:bg-accent",
  quiet: "hover:bg-accent",
  danger: "text-danger hover:bg-danger/10",
}
const sizes = { md: "h-9 px-4", sm: "h-8 px-2.5", icon: "size-9" }

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: keyof typeof variants; size?: keyof typeof sizes }) {
  return (
    <button
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  )
}
