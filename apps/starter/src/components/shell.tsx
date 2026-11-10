"use client"

import { AppShell } from "@templates/shell"
import type { ComponentProps } from "react"

import { nav } from "@/config/nav"

/** Binds the app's nav config (with icons) to the shell on the client side. */
export function Shell(props: Omit<ComponentProps<typeof AppShell>, "nav">) {
  return <AppShell nav={nav} {...props} />
}
