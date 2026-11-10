"use client"

import * as D from "@radix-ui/react-dropdown-menu"
import type { ComponentProps } from "react"

import { cn } from "./cn"

export const Dropdown = D.Root
export const DropdownTrigger = D.Trigger
export const DropdownLabel = ({ className, ...p }: ComponentProps<typeof D.Label>) => (
  <D.Label className={cn("px-2 py-1.5 text-xs text-muted-foreground", className)} {...p} />
)
export const DropdownSeparator = () => <D.Separator className="-mx-1 my-1 h-px bg-border" />

export function DropdownContent({ className, ...p }: ComponentProps<typeof D.Content>) {
  return (
    <D.Portal>
      <D.Content
        sideOffset={6}
        className={cn("z-50 min-w-48 rounded-md border bg-background p-1 shadow-lg", className)}
        {...p}
      />
    </D.Portal>
  )
}

export function DropdownItem({ className, ...p }: ComponentProps<typeof D.Item>) {
  return (
    <D.Item
      className={cn(
        "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-accent [&_svg]:size-4 [&_svg]:text-muted-foreground",
        className,
      )}
      {...p}
    />
  )
}
