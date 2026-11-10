"use client"

import { organization, signOut } from "@templates/auth/client"
import { Button } from "@templates/ui/button"
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
} from "@templates/ui/dropdown"
import { Sheet, SheetContent, SheetTrigger } from "@templates/ui/sheet"
import { Check, ChevronsUpDown, LogOut, Menu, Plus, Search, Settings, User } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { CommandPalette, useOpenPalette } from "./command-palette"
import { NavLinks } from "./nav"
import { ThemeToggle } from "./theme"
import type { NavGroup, ShellOrg, ShellUser } from "./types"

type Props = {
  nav: NavGroup[]
  /** From `allowedHrefs()` on the server. Items not listed are hidden. */
  allowed: string[]
  user: ShellUser
  orgs: ShellOrg[]
  activeOrgId: string
  children: React.ReactNode
}

/**
 * Signed-in layout: sidebar (drawer on mobile), top bar with search,
 * theme toggle and user menu, and a ⌘K command palette.
 */
export function AppShell({ nav: allNav, allowed, user, orgs, activeOrgId, children }: Props) {
  const nav = allNav
    .map((g) => ({ ...g, items: g.items.filter((i) => allowed.includes(i.href)) }))
    .filter((g) => g.items.length > 0)
  return (
    <CommandPalette groups={nav}>
      <div className="flex min-h-dvh">
        <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r bg-sidebar lg:flex">
          <SidebarBody nav={nav} orgs={orgs} activeOrgId={activeOrgId} />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar nav={nav} user={user} orgs={orgs} activeOrgId={activeOrgId} />
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">{children}</main>
        </div>
      </div>
    </CommandPalette>
  )
}

function SidebarBody({
  nav,
  orgs,
  activeOrgId,
  onNavigate,
}: Pick<Props, "nav" | "orgs" | "activeOrgId"> & { onNavigate?: () => void }) {
  return (
    <>
      <div className="border-b p-3">
        <OrgSwitcher orgs={orgs} activeOrgId={activeOrgId} />
      </div>
      <div className="flex-1 overflow-y-auto">
        <NavLinks groups={nav} onNavigate={onNavigate} />
      </div>
    </>
  )
}

function OrgSwitcher({ orgs, activeOrgId }: { orgs: ShellOrg[]; activeOrgId: string }) {
  const router = useRouter()
  const active = orgs.find((o) => o.id === activeOrgId)
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md p-1.5 text-left hover:bg-accent"
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
            {active?.name.charAt(0).toUpperCase()}
          </span>
          <span className="flex-1 truncate text-sm font-medium">{active?.name}</span>
          <ChevronsUpDown className="size-4 text-muted-foreground" />
        </button>
      </DropdownTrigger>
      <DropdownContent align="start" className="w-60">
        <DropdownLabel>Organizations</DropdownLabel>
        {orgs.map((o) => (
          <DropdownItem
            key={o.id}
            onSelect={async () => {
              if (o.id === activeOrgId) return
              await organization.setActive({ organizationId: o.id })
              router.refresh()
            }}
          >
            <span className="flex-1 truncate">{o.name}</span>
            {o.id === activeOrgId && <Check />}
          </DropdownItem>
        ))}
        <DropdownSeparator />
        <DropdownItem onSelect={() => router.push("/onboarding")}>
          <Plus /> New organization
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  )
}

function Topbar({ nav, user, orgs, activeOrgId }: Omit<Props, "children" | "allowed">) {
  const openPalette = useOpenPalette()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur sm:px-6">
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetTrigger asChild>
          <Button variant="quiet" size="icon" className="lg:hidden" aria-label="Open menu">
            <Menu />
          </Button>
        </SheetTrigger>
        <SheetContent title="Navigation">
          <SidebarBody
            nav={nav}
            orgs={orgs}
            activeOrgId={activeOrgId}
            onNavigate={() => setMenuOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <button
        type="button"
        onClick={openPalette}
        className="flex h-9 w-full max-w-xs items-center gap-2 rounded-md border px-3 text-sm text-muted-foreground hover:bg-accent"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="hidden rounded border px-1.5 font-mono text-xs sm:inline">⌘K</kbd>
      </button>

      <div className="ml-auto flex items-center gap-1">
        <ThemeToggle />
        <UserMenu user={user} />
      </div>
    </header>
  )
}

function UserMenu({ user }: { user: ShellUser }) {
  const router = useRouter()
  const initials = user.name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="grid size-9 place-items-center rounded-full bg-accent text-xs font-semibold hover:opacity-80"
        >
          {initials}
        </button>
      </DropdownTrigger>
      <DropdownContent align="end">
        <DropdownLabel>
          <span className="block font-medium text-foreground">{user.name}</span>
          {user.email}
        </DropdownLabel>
        <DropdownSeparator />
        <DropdownItem asChild>
          <Link href="/settings/profile">
            <User /> Profile
          </Link>
        </DropdownItem>
        <DropdownItem asChild>
          <Link href="/settings/organization">
            <Settings /> Organization settings
          </Link>
        </DropdownItem>
        <DropdownSeparator />
        <DropdownItem
          onSelect={async () => {
            await signOut()
            router.replace("/sign-in")
            router.refresh()
          }}
        >
          <LogOut /> Sign out
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  )
}
