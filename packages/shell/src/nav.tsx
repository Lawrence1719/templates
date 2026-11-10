"use client"

import { cn } from "@templates/ui/cn"
import Link from "next/link"
import { usePathname } from "next/navigation"

import type { NavGroup } from "./types"

export function isActive(pathname: string, href: string) {
  return href === "/dashboard"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`)
}

export function NavLinks({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  const pathname = usePathname()
  return (
    <nav className="grid gap-5 p-3" aria-label="Main">
      {groups.map((g, i) => (
        <div key={g.label ?? i} className="grid gap-0.5">
          {g.label && (
            <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">{g.label}</p>
          )}
          {g.items.map(({ href, title, icon: Icon }) => {
            const active = isActive(pathname, href)
            return (
              <Link
                key={href}
                href={href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-9 items-center gap-2.5 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                  active && "bg-accent font-medium text-foreground",
                )}
              >
                <Icon className="size-4" />
                {title}
              </Link>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
