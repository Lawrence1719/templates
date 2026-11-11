import { requirePermission } from "@templates/auth/guards"
import { CrmError, crmMembers, getCustomer } from "@templates/crm"
import { Card, PageHeader } from "@templates/ui/card"
import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"

import { CustomerForm } from "@/components/crm"

export const metadata: Metadata = { title: "Edit customer" }

export default async function EditCustomerPage({ params }: PageProps<"/customers/[id]/edit">) {
  const { id } = await params
  const ctx = await requirePermission({ customer: ["write"] }).catch(() =>
    redirect(`/customers/${id}`),
  )
  const [{ customer: c }, members] = await Promise.all([
    getCustomer(ctx, id).catch((e) => {
      if (e instanceof CrmError) notFound()
      throw e
    }),
    crmMembers(ctx),
  ])
  return (
    <div className="mx-auto grid w-full max-w-2xl gap-6">
      <PageHeader title={`Edit ${c.name}`} />
      <Card>
        <CustomerForm
          id={c.id}
          members={members}
          initial={{
            kind: c.kind,
            name: c.name,
            email: c.email ?? "",
            phone: c.phone ?? "",
            website: c.website ?? "",
            address: c.address ?? "",
            status: c.status,
            ownerId: c.ownerId ?? "",
            tags: c.tags.join(", "),
          }}
        />
      </Card>
    </div>
  )
}
