"use client"

import { signOut } from "@templates/auth/client"
import { Dialog, DialogContent } from "@templates/ui/sheet"
import { Command } from "cmdk"
import { LogOut, Moon, Search, Sun } from "lucide-react"
import { useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import { createContext, useContext, useEffect, useState } from "react"

import type { NavGroup } from "./types"

const PaletteContext = createContext<() => void>(() => {})
export const useOpenPalette = () => useContext(PaletteContext)

const itemClass =
  "flex cursor-default items-center gap-2.5 rounded-md px-2 py-2 text-sm data-[selected=true]:bg-accent [&_svg]:size-4 [&_svg]:text-muted-foreground"

export function CommandPalette({
  groups,
  children,
}: {
  groups: NavGroup[]
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const { setTheme } = useTheme()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const run = (fn: () => void) => {
    setOpen(false)
    fn()
  }

  return (
    <PaletteContext.Provider value={() => setOpen(true)}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Command palette">
          <Command loop>
            <div className="flex items-center gap-2 border-b px-3">
              <Search className="size-4 text-muted-foreground" />
              <Command.Input
                autoFocus
                placeholder="Search pages and actions…"
                className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <Command.List className="max-h-80 overflow-y-auto p-2">
              <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
                No results.
              </Command.Empty>
              {groups.map((g, i) => (
                <Command.Group
                  key={g.label ?? i}
                  heading={g.label ?? "Pages"}
                  className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground"
                >
                  {g.items.map(({ href, title, icon: Icon, keywords }) => (
                    <Command.Item
                      key={href}
                      value={`${title} ${href}`}
                      keywords={keywords}
                      onSelect={() => run(() => router.push(href))}
                      className={itemClass}
                    >
                      <Icon />
                      {title}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
              <Command.Group
                heading="Actions"
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground"
              >
                <Command.Item onSelect={() => run(() => setTheme("light"))} className={itemClass}>
                  <Sun /> Light theme
                </Command.Item>
                <Command.Item onSelect={() => run(() => setTheme("dark"))} className={itemClass}>
                  <Moon /> Dark theme
                </Command.Item>
                <Command.Item
                  onSelect={() =>
                    run(async () => {
                      await signOut()
                      router.replace("/sign-in")
                      router.refresh()
                    })
                  }
                  className={itemClass}
                >
                  <LogOut /> Sign out
                </Command.Item>
              </Command.Group>
            </Command.List>
          </Command>
        </DialogContent>
      </Dialog>
    </PaletteContext.Provider>
  )
}
