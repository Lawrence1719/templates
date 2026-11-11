import { requirePermission } from "@templates/auth/guards"
import { listLocations } from "@templates/inventory"
import { getPosSettings, listRegisters } from "@templates/pos"
import { Card, PageHeader } from "@templates/ui/card"
import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { PosSettingsForm, RegisterForm, RegisterRow } from "@/components/pos"

export const metadata: Metadata = { title: "Point-of-sale setup" }

export default async function PosSetupPage() {
  const ctx = await requirePermission({ pos: ["manage"] }).catch(() => redirect("/pos"))
  const [settings, registers, locations] = await Promise.all([
    getPosSettings(ctx),
    listRegisters(ctx, { includeArchived: true }),
    listLocations(ctx),
  ])
  const locs = locations.map((l) => ({ id: l.id, name: l.name }))

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <PageHeader
        title="Point-of-sale setup"
        description="Registers, tax, discounts and what the receipt says."
      />

      <Card className="grid gap-4 p-5">
        <div>
          <h2 className="font-semibold">Registers</h2>
          <p className="text-sm text-muted-foreground">
            Each register sells from one stock location, so sales take stock from the right shelf.
          </p>
        </div>
        {locs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add a location in{" "}
            <Link href="/inventory/locations" className="underline">
              Inventory
            </Link>{" "}
            first.
          </p>
        ) : (
          <RegisterForm id={null} locations={locs} />
        )}
        {registers.length > 0 && (
          <ul className="divide-y border-t">
            {registers.map((r) => (
              <RegisterRow key={r.id} register={r} locations={locs} />
            ))}
          </ul>
        )}
      </Card>

      <Card className="grid gap-4 p-5">
        <div>
          <h2 className="font-semibold">Till settings</h2>
          <p className="text-sm text-muted-foreground">
            The till only shows products priced in this currency.
          </p>
        </div>
        <PosSettingsForm
          initial={{
            receiptPrefix: settings.receiptPrefix,
            currency: settings.currency,
            taxRate: String(settings.taxRateBp / 100),
            pricesIncludeTax: settings.pricesIncludeTax,
            maxDiscount: String(settings.maxDiscountBp / 100),
            timeZone: settings.timeZone,
            receiptHeader: settings.receiptHeader ?? "",
            receiptFooter: settings.receiptFooter ?? "",
          }}
        />
      </Card>
    </div>
  )
}
