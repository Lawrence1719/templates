import { requirePermission } from "@templates/auth/guards"
import { productCategories } from "@templates/inventory"
import { Card, PageHeader } from "@templates/ui/card"
import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { ProductForm } from "@/components/inventory"

export const metadata: Metadata = { title: "New product" }

export default async function NewProductPage() {
  const ctx = await requirePermission({ inventory: ["manage"] }).catch(() => redirect("/inventory"))
  const categories = await productCategories(ctx)
  return (
    <div className="mx-auto grid w-full max-w-2xl gap-6">
      <PageHeader title="New product" />
      <Card>
        <ProductForm
          id={null}
          categories={categories}
          initial={{
            sku: "",
            name: "",
            description: "",
            category: "",
            barcode: "",
            unit: "pcs",
            currency: "USD",
            cost: "",
            price: "",
            reorderPoint: "0",
            reorderQty: "0",
          }}
        />
      </Card>
    </div>
  )
}
