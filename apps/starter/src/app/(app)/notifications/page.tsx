import { requireOrg } from "@templates/auth/guards"
import { listNotifications } from "@templates/notifications"
import { Card, PageHeader } from "@templates/ui/card"
import { cn } from "@templates/ui/cn"
import type { Metadata } from "next"
import Link from "next/link"

import { MarkAllRead, MarkReadLink } from "@/components/notification-actions"
import { timeAgo } from "@/components/time-ago"

export const metadata: Metadata = { title: "Notifications" }

export default async function NotificationsPage({ searchParams }: PageProps<"/notifications">) {
  const { user, orgId } = await requireOrg()
  const unreadOnly = (await searchParams).filter === "unread"
  const items = await listNotifications({ userId: user.id, orgId }, { limit: 100, unreadOnly })

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader
        title="Notifications"
        description="Updates about your organization and your account."
        actions={<MarkAllRead disabled={!items.some((n) => !n.readAt)} />}
      />
      <div
        role="group"
        aria-label="Filter"
        className="inline-flex w-fit rounded-md border p-0.5 text-sm"
      >
        {[
          ["All", "/notifications"],
          ["Unread", "/notifications?filter=unread"],
        ].map(([label, href]) => {
          const active = (label === "Unread") === unreadOnly
          return (
            <Link
              key={label}
              href={href ?? "/notifications"}
              aria-current={active ? "true" : undefined}
              className={cn(
                "rounded-[5px] px-3 py-1 text-muted-foreground hover:text-foreground",
                active && "bg-accent font-medium text-foreground",
              )}
            >
              {label}
            </Link>
          )
        })}
      </div>
      <Card className="p-0">
        {items.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            {unreadOnly ? "No unread notifications." : "No notifications yet."}
          </p>
        ) : (
          <ul className="divide-y">
            {items.map((n) => (
              <li key={n.id} className="flex gap-3 px-5 py-4">
                <span
                  className={cn(
                    "mt-1.5 size-2 shrink-0 rounded-full",
                    n.readAt ? "bg-transparent" : "bg-chart-1",
                  )}
                  aria-label={n.readAt ? undefined : "Unread"}
                />
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm", !n.readAt && "font-medium")}>{n.title}</p>
                  {n.body && <p className="mt-0.5 text-sm text-muted-foreground">{n.body}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">{timeAgo(n.createdAt)}</p>
                </div>
                <MarkReadLink id={n.id} link={n.link} read={!!n.readAt} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
