import { requirePermission } from "@templates/auth/guards"
import { getMembershipSettings, listPlans } from "@templates/memberships"
import { Card, PageHeader } from "@templates/ui/card"
import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { MembershipSettingsForm, PlanForm, PlanRowItem } from "@/components/memberships"

export const metadata: Metadata = { title: "Membership plans" }

export default async function PlansPage() {
  const ctx = await requirePermission({ membership: ["manage"] }).catch(() =>
    redirect("/memberships"),
  )
  const [plans, settings] = await Promise.all([
    listPlans(ctx, { includeArchived: true }),
    getMembershipSettings(ctx),
  ])
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <PageHeader
        title="Plans"
        description="What people can sign up for, and how check-ins and reminders work."
      />
      <Card className="grid gap-4 p-5">
        <h2 className="font-semibold">Plans</h2>
        {plans.length > 0 && (
          <ul className="divide-y border-b">
            {plans.map((p) => (
              <PlanRowItem key={p.id} plan={p} />
            ))}
          </ul>
        )}
        <h3 className="text-sm font-medium">Add a plan</h3>
        <PlanForm />
      </Card>
      <Card className="grid gap-4 p-5">
        <h2 className="font-semibold">Settings</h2>
        <MembershipSettingsForm
          initial={{
            timeZone: settings.timeZone,
            checkInCooldownMinutes: settings.checkInCooldownMinutes,
            reminderDays: settings.reminderDays,
          }}
        />
      </Card>
    </div>
  )
}
