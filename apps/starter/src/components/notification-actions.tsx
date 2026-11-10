"use client"

import { Button } from "@templates/ui/button"
import { useRouter } from "next/navigation"
import { useTransition } from "react"

import { markNotificationsRead } from "@/app/actions/notifications"

export function MarkAllRead({ disabled }: { disabled: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <Button
      variant="ghost"
      disabled={disabled || pending}
      onClick={() =>
        start(async () => {
          await markNotificationsRead("all")
          router.refresh()
        })
      }
    >
      Mark all read
    </Button>
  )
}

export function MarkReadLink({
  id,
  link,
  read,
}: {
  id: string
  link: string | null
  read: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  if (!link && read) return null
  return (
    <Button
      variant="quiet"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          if (!read) await markNotificationsRead([id])
          if (link) router.push(link)
          else router.refresh()
        })
      }
    >
      {link ? "Open" : "Mark read"}
    </Button>
  )
}
