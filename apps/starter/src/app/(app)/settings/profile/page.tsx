import { requireUser } from "@templates/auth/guards"
import { Card, PageHeader } from "@templates/ui/card"
import type { Metadata } from "next"

import { ProfileForm } from "@/components/settings"

export const metadata: Metadata = { title: "Profile" }

export default async function ProfilePage() {
  const { user } = await requireUser()
  return (
    <div className="grid gap-8">
      <PageHeader title="Profile" description="Your personal account details." />
      <Card className="max-w-xl">
        <ProfileForm name={user.name} email={user.email} />
      </Card>
    </div>
  )
}
