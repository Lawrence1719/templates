import { requirePermission } from "@templates/auth/guards"
import { getSale, PosError } from "@templates/pos"
import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"

import { AutoPrint } from "@/components/auto-print"
import { Receipt } from "@/components/pos-receipt"
import { PrintButton } from "@/components/print-button"

export const metadata: Metadata = { title: "Receipt", robots: { index: false, follow: false } }

/** A bare receipt page for printing, outside the app shell. Signed-in staff only. */
export default async function ReceiptPage({ params, searchParams }: PageProps<"/receipt/[id]">) {
  const { orgId } = await requirePermission({ pos: ["read"] }).catch(() => redirect("/dashboard"))
  const data = await getSale({ orgId }, (await params).id).catch((e) => {
    if (e instanceof PosError && e.status === 404) notFound()
    throw e
  })
  const { print } = await searchParams
  return (
    <main className="min-h-dvh px-4 py-8 print:p-0">
      <div className="mx-auto mb-6 flex max-w-xs justify-center print:hidden">
        <PrintButton />
      </div>
      <Receipt data={data} />
      {print === "1" && <AutoPrint />}
    </main>
  )
}
