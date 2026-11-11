import { requirePermission } from "@templates/auth/guards"
import { orderOptions, today } from "@templates/orders"
import { Card, PageHeader } from "@templates/ui/card"
import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { OrderEditor } from "@/components/orders"

export const metadata: Metadata = { title: "New order" }

export default async function NewOrderPage({ searchParams }: PageProps<"/orders/new">) {
  const ctx = await requirePermission({ order: ["write"] }).catch(() => redirect("/orders"))
  const sp = await searchParams
  const { customers, products, locations } = await orderOptions(ctx)
  const preset =
    typeof sp.customer === "string" ? customers.find((c) => c.id === sp.customer) : undefined
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader title="New order" />
      {customers.length === 0 ? (
        <Card className="text-sm">
          Add a{" "}
          <Link href="/customers/new" className="underline">
            customer
          </Link>{" "}
          first: every order is for one.
        </Card>
      ) : (
        <Card>
          <OrderEditor
            id={null}
            customers={customers}
            products={products}
            locations={locations}
            initial={{
              customerId: preset?.id ?? "",
              orderDate: today(),
              requestedOn: "",
              locationId: locations.length === 1 ? (locations[0]?.id ?? "") : "",
              currency: products[0]?.currency ?? "USD",
              shippingAddress: preset?.address ?? "",
              notes: "",
              lines: [],
            }}
          />
        </Card>
      )}
    </div>
  )
}
