import { requirePermission } from "@templates/auth/guards"
import { getProduct, InventoryError, productCategories } from "@templates/inventory"
import { Card, PageHeader } from "@templates/ui/card"
import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"

import { ProductForm } from "@/components/inventory"

export const metadata: Metadata = { title: "Edit product" }

const qty = (milli: number) => String(milli / 1000)
const money = (cents: number) => (cents / 100).toFixed(2)

export default async function EditProductPage({ params }: PageProps<"/inventory/[id]/edit">) {
  const { id } = await params
  const ctx = await requirePermission({ inventory: ["manage"] }).catch(() =>
    redirect(`/inventory/${id}`),
  )
  const [{ product: p }, categories] = await Promise.all([
    getProduct(ctx, id).catch((e) => {
      if (e instanceof InventoryError) notFound()
      throw e
    }),
    productCategories(ctx),
  ])
  return (
    <div className="mx-auto grid w-full max-w-2xl gap-6">
      <PageHeader title={`Edit ${p.name}`} />
      <Card>
        <ProductForm
          id={p.id}
          categories={categories}
          initial={{
            sku: p.sku,
            name: p.name,
            description: p.description ?? "",
            category: p.category ?? "",
            barcode: p.barcode ?? "",
            unit: p.unit,
            currency: p.currency,
            cost: money(p.costCents),
            price: money(p.priceCents),
            reorderPoint: qty(p.reorderPointMilli),
            reorderQty: qty(p.reorderQtyMilli),
          }}
        />
      </Card>
    </div>
  )
}
