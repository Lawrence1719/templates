import { requirePermission } from "@templates/auth/guards"
import { addDays, getSettings, invoiceCustomers, today } from "@templates/invoicing"
import { Card, PageHeader } from "@templates/ui/card"
import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { InvoiceEditor } from "@/components/invoicing"

export const metadata: Metadata = { title: "New invoice" }

export default async function NewInvoicePage({ searchParams }: PageProps<"/invoices/new">) {
  const ctx = await requirePermission({ invoice: ["write"] }).catch(() => redirect("/invoices"))
  const sp = await searchParams
  const kind = sp.kind === "quote" ? "quote" : "invoice"
  const [settings, customers] = await Promise.all([getSettings(ctx), invoiceCustomers(ctx)])
  const preset =
    typeof sp.customer === "string" && customers.some((c) => c.id === sp.customer)
      ? sp.customer
      : ""
  const issue = today()
  const defaultTax = String(settings.defaultTaxRateBp / 100)

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader title={`New ${kind}`} />
      {customers.length === 0 ? (
        <Card className="text-sm">
          Add a{" "}
          <Link href="/customers/new" className="underline">
            customer
          </Link>{" "}
          first: every {kind} is for one.
        </Card>
      ) : (
        <Card>
          <InvoiceEditor
            id={null}
            kind={kind}
            customers={customers}
            defaultTaxRate={defaultTax}
            canDelete={false}
            initial={{
              customerId: preset,
              issueDate: issue,
              dueOn: addDays(issue, kind === "quote" ? 30 : settings.defaultDueDays),
              currency: settings.defaultCurrency,
              notes: "",
              terms: "",
              lines: [],
            }}
          />
        </Card>
      )}
    </div>
  )
}
