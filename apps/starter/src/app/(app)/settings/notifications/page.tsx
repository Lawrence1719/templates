import { requireUser } from "@templates/auth/guards"
import { getPreferences } from "@templates/notifications"
import { Card, PageHeader } from "@templates/ui/card"
import type { Metadata } from "next"

import { PreferenceRow } from "@/components/notification-preferences"

export const metadata: Metadata = { title: "Notification settings" }

export default async function NotificationSettingsPage() {
  const { user } = await requireUser()
  const prefs = await getPreferences(user.id)
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Notification settings"
        description="Choose how you hear about each kind of update."
      />
      <Card className="p-0">
        <div className="grid grid-cols-[minmax(0,1fr)_4rem_4rem] items-center gap-x-2 border-b px-5 py-2.5 text-xs font-medium text-muted-foreground">
          <span>Notify me when…</span>
          <span className="text-center">In app</span>
          <span className="text-center">Email</span>
        </div>
        <ul className="divide-y">
          {prefs.map((p) => (
            <PreferenceRow key={p.type} pref={p} />
          ))}
        </ul>
      </Card>
    </div>
  )
}
