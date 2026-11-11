import { requirePermission } from "@templates/auth/guards"
import { crmMembers } from "@templates/crm"
import { Card, PageHeader } from "@templates/ui/card"
import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { CustomerForm } from "@/components/crm"

export const metadata: Metadata = { title: "New customer" }

export default async function NewCustomerPage() {
  const ctx = await requirePermission({ customer: ["write"] }).catch(() => redirect("/customers"))
  const members = await crmMembers(ctx)
  return (
    <div className="mx-auto grid w-full max-w-2xl gap-6">
      <PageHeader title="New customer" />
      <Card>
        <CustomerForm
          members={members}
          initial={{
            kind: "company",
            name: "",
            email: "",
            phone: "",
            website: "",
            address: "",
            status: "lead",
            // New customers belong to whoever adds them, unless changed.
            ownerId: ctx.user.id,
            tags: "",
          }}
        />
      </Card>
    </div>
  )
}
