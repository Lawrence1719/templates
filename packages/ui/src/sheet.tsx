"use client"

import * as D from "@radix-ui/react-dialog"
import type { ComponentProps } from "react"

import { cn } from "./cn"

export const Sheet = D.Root
export const SheetTrigger = D.Trigger
export const SheetClose = D.Close

/** Slide-in panel from the left (mobile nav, filters). */
export function SheetContent({
  title,
  className,
  children,
  ...p
}: ComponentProps<typeof D.Content> & { title: string }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-black/40" />
      <D.Content
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r bg-sidebar shadow-xl outline-none",
          className,
        )}
        {...p}
      >
        <D.Title className="sr-only">{title}</D.Title>
        <D.Description className="sr-only">{title}</D.Description>
        {children}
      </D.Content>
    </D.Portal>
  )
}

export const Dialog = D.Root
export function DialogContent({
  title,
  className,
  children,
  ...p
}: ComponentProps<typeof D.Content> & { title: string }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-black/40" />
      <D.Content
        className={cn(
          "fixed top-[15vh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 overflow-hidden rounded-xl border bg-background shadow-2xl outline-none",
          className,
        )}
        {...p}
      >
        <D.Title className="sr-only">{title}</D.Title>
        <D.Description className="sr-only">{title}</D.Description>
        {children}
      </D.Content>
    </D.Portal>
  )
}
