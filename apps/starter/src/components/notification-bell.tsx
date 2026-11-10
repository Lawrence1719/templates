"use client"

import type { Notification } from "@templates/db/schema"
import { Button } from "@templates/ui/button"
import { cn } from "@templates/ui/cn"
import { Dropdown, DropdownContent, DropdownTrigger } from "@templates/ui/dropdown"
import { Bell } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

import { getInbox, getUnreadCount, markNotificationsRead } from "@/app/actions/notifications"

import { timeAgo } from "./time-ago"

const POLL_MS = 60_000

export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const router = useRouter()
  const [unread, setUnread] = useState(initialUnread)
  const [items, setItems] = useState<Notification[] | null>(null)

  // Poll for new notifications while the tab is visible.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") getUnreadCount().then(setUnread, () => {})
    }
    const id = setInterval(tick, POLL_MS)
    document.addEventListener("visibilitychange", tick)
    return () => {
      clearInterval(id)
      document.removeEventListener("visibilitychange", tick)
    }
  }, [])

  const load = useCallback(async () => {
    const inbox = await getInbox()
    setItems(inbox.items)
    setUnread(inbox.unread)
  }, [])

  async function open(n: Notification) {
    if (!n.readAt) {
      setUnread((u) => Math.max(0, u - 1))
      setItems((xs) => xs?.map((x) => (x.id === n.id ? { ...x, readAt: new Date() } : x)) ?? null)
      await markNotificationsRead([n.id])
    }
    if (n.link) router.push(n.link)
  }

  async function markAll() {
    setUnread(0)
    setItems((xs) => xs?.map((x) => ({ ...x, readAt: x.readAt ?? new Date() })) ?? null)
    await markNotificationsRead("all")
  }

  return (
    <Dropdown onOpenChange={(o) => o && load()}>
      <DropdownTrigger asChild>
        <Button
          variant="quiet"
          size="icon"
          className="relative"
          aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        >
          <Bell />
          {unread > 0 && (
            <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] leading-4 font-semibold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </DropdownTrigger>
      <DropdownContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-medium">Notifications</p>
          {unread > 0 && (
            <button
              type="button"
              onClick={markAll}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {items === null ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : items.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">You're all caught up.</p>
          ) : (
            <ul className="divide-y">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => open(n)}
                    className="flex w-full gap-2.5 px-3 py-2.5 text-left hover:bg-accent"
                  >
                    <span
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        n.readAt ? "bg-transparent" : "bg-chart-1",
                      )}
                      aria-label={n.readAt ? undefined : "Unread"}
                    />
                    <span className="min-w-0">
                      <span className={cn("block text-sm", !n.readAt && "font-medium")}>
                        {n.title}
                      </span>
                      {n.body && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {n.body}
                        </span>
                      )}
                      <span className="block text-xs text-muted-foreground">
                        {timeAgo(new Date(n.createdAt))}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Link
          href="/notifications"
          className="block border-t px-3 py-2 text-center text-xs text-muted-foreground hover:text-foreground"
        >
          View all
        </Link>
      </DropdownContent>
    </Dropdown>
  )
}
