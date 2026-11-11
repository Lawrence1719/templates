import { requirePermission } from "@templates/auth/guards"
import { getSettings } from "@templates/invoicing"
import { Card, PageHeader } from "@templates/ui/card"
import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { SettingsForm } from "@/components/invoicing"

export const metadata: Metadata = { title: "Invoice settings" }

export default async function InvoiceSettingsPage() {
  const ctx = await requirePermission({ invoice: ["settings"] }).catch(() => redirect("/invoices"))
  const s = await getSettings(ctx)
  return (
    <div className="mx-auto grid w-full max-w-2xl gap-6">
      <PageHeader
        title="Invoice settings"
        description="Numbering, defaults and what appears on every document."
      />
      <Card>
        <SettingsForm
          initial={{
            invoicePrefix: s.invoicePrefix,
            quotePrefix: s.quotePrefix,
            nextInvoiceNumber: String(s.nextInvoiceNumber),
            nextQuoteNumber: String(s.nextQuoteNumber),
            defaultDueDays: String(s.defaultDueDays),
            defaultTaxRate: String(s.defaultTaxRateBp / 100),
            defaultCurrency: s.defaultCurrency,
            businessName: s.businessName ?? "",
            businessDetails: s.businessDetails ?? "",
            paymentInstructions: s.paymentInstructions ?? "",
            footer: s.footer ?? "",
          }}
        />
      </Card>
    </div>
  )
}
