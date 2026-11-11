import { can, requirePermission } from "@templates/auth/guards"
import { getRegister, PosError, tillCatalog } from "@templates/pos"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { OpenShift, Till } from "@/components/pos-till"

export const metadata: Metadata = { title: "Till" }

export default async function TillPage({ params }: PageProps<"/pos/till/[registerId]">) {
  const { orgId } = await requirePermission({ pos: ["sell"] }).catch(() => redirect("/pos"))
  const { registerId } = await params
  const reg = await getRegister({ orgId }, registerId).catch((e) => {
    if (e instanceof PosError && e.status === 404) notFound()
    throw e
  })
  if (reg.register.status !== "active") redirect("/pos")
  const back = (
    <Link href="/pos" className="text-sm text-muted-foreground hover:underline">
      ← Point of sale
    </Link>
  )
  if (!reg.shift) {
    const { settings } = await tillCatalog({ orgId }, registerId)
    return (
      <div className="grid gap-6">
        {back}
        <OpenShift registerId={registerId} currency={settings.currency} />
      </div>
    )
  }
  const [catalog, canDiscountAny] = await Promise.all([
    tillCatalog({ orgId }, registerId),
    can({ pos: ["manage"] }),
  ])
  return (
    <div className="grid gap-4">
      {back}
      <Till
        registerId={registerId}
        registerName={reg.register.name}
        shift={{
          id: reg.shift.id,
          openedAt: reg.shift.openedAt.toISOString(),
          openedBy: reg.openedByName,
        }}
        products={catalog.products}
        customers={catalog.customers}
        settings={{
          currency: catalog.settings.currency,
          taxRateBp: catalog.settings.taxRateBp,
          pricesIncludeTax: catalog.settings.pricesIncludeTax,
          maxDiscountBp: catalog.settings.maxDiscountBp,
        }}
        canDiscountAny={canDiscountAny}
      />
    </div>
  )
}
