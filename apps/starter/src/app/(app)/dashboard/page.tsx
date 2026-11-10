import { auth } from "@templates/auth"
import { requireOrg } from "@templates/auth/guards"
import { Card, PageHeader } from "@templates/ui/card"
import type { Metadata } from "next"
import { headers } from "next/headers"
import Link from "next/link"

export const metadata: Metadata = { title: "Dashboard" }

export default async function DashboardPage() {
  const { user, orgId } = await requireOrg()
  const org = await auth.api.getFullOrganization({
    headers: await headers(),
    query: { organizationId: orgId },
  })
  if (!org) return null
  const pending = org.invitations.filter((i) => i.status === "pending").length
  const role = org.members.find((m) => m.userId === user.id)?.role

  const stats = [
    { label: "Members", value: org.members.length, href: "/settings/organization" },
    { label: "Pending invites", value: pending, href: "/settings/organization" },
    { label: "Your role", value: role, href: "/settings/profile" },
  ]

  return (
    <div className="grid gap-8">
      <PageHeader
        title={`Welcome, ${user.name.split(" ")[0]}`}
        description={`Here's what's happening in ${org.name}.`}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="rounded-xl transition-colors hover:bg-accent"
          >
            <Card>
              <p className="text-sm text-muted-foreground">{s.label}</p>
              <p className="mt-1 text-2xl font-semibold capitalize">{s.value}</p>
            </Card>
          </Link>
        ))}
      </div>
      <Card className="border-dashed text-center">
        <p className="text-sm text-muted-foreground">
          Modules you add (CRM, inventory, orders…) show up in the sidebar and here.
        </p>
      </Card>
    </div>
  )
}
