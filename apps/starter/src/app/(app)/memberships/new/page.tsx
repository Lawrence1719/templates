import { requirePermission } from "@templates/auth/guards"
import { getMembershipSettings, membershipOptions } from "@templates/memberships"
import { today } from "@templates/memberships/definitions"
import { PageHeader } from "@templates/ui/card"
import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { StartMembershipForm } from "@/components/memberships"

export const metadata: Metadata = { title: "New membership" }

export default async function NewMembershipPage({ searchParams }: PageProps<"/memberships/new">) {
  const { orgId } = await requirePermission({ membership: ["sell"] }).catch(() =>
    redirect("/memberships"),
  )
  const sp = await searchParams
  const [{ customers, plans }, settings] = await Promise.all([
    membershipOptions({ orgId }),
    getMembershipSettings({ orgId }),
  ])
  const c = Array.isArray(sp.customer) ? sp.customer[0] : sp.customer
  return (
    <div className="mx-auto grid w-full max-w-2xl gap-6">
      <PageHeader
        title="New membership"
        description="They'll get an email with their card link if they have an email address."
      />
      <StartMembershipForm
        customers={customers}
        plans={plans}
        defaultDay={today(settings.timeZone)}
        defaultCustomer={customers.some((x) => x.id === c) ? c : undefined}
      />
    </div>
  )
}
