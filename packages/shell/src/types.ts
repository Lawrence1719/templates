import type { Permissions } from "@templates/auth/permissions"
import type { LucideIcon } from "lucide-react"

export type NavItem = {
  title: string
  href: string
  icon: LucideIcon
  /** Hidden unless the user's role grants this. The page must still check it. */
  permission?: Permissions
  /** Extra words the command palette matches on. */
  keywords?: string[]
}

export type NavGroup = { label?: string; items: NavItem[] }

/** Serializable version sent to client components (icons resolved by name). */
export type ShellUser = { name: string; email: string; image?: string | null }
export type ShellOrg = { id: string; name: string }
