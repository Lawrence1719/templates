import { can, requirePermission } from "@templates/auth/guards"
import { formatQuantity, listLocations } from "@templates/inventory"
import { Card, PageHeader } from "@templates/ui/card"
import { cn } from "@templates/ui/cn"
import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { LocationEditor } from "@/components/inventory"
import { InventoryTabs } from "@/components/inventory-shared"

export const metadata: Metadata = { title: "Locations" }

export default async function LocationsPage() {
  const { orgId } = await requirePermission({ inventory: ["read"] }).catch(() =>
    redirect("/dashboard"),
  )
  const [locations, canManage] = await Promise.all([
    listLocations({ orgId }, { includeArchived: true }),
    can({ inventory: ["manage"] }),
  ])
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader
        title="Inventory"
        description="Warehouses, stores, vans or shelves: anywhere you keep stock."
        actions={canManage && <LocationEditor />}
      />
      <InventoryTabs current="/inventory/locations" />
      <Card className="p-0">
        {locations.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            No locations yet. Add where you keep stock.
          </p>
        ) : (
          <ul className="divide-y">
            {locations.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "font-medium",
                      l.status === "archived" && "text-muted-foreground",
                    )}
                  >
                    {l.name}
                    {l.status === "archived" && (
                      <span className="ml-2 text-xs font-normal">(archived)</span>
                    )}
                  </p>
                  {l.address && <p className="text-xs text-muted-foreground">{l.address}</p>}
                </div>
                <p className="text-sm text-muted-foreground">
                  {l.products} {l.products === 1 ? "product" : "products"} ·{" "}
                  {formatQuantity(l.units)} units
                </p>
                {canManage && <LocationEditor location={l} />}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
