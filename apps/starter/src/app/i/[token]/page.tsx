import { getPublicInvoice, invoiceState, today } from "@templates/invoicing"
import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { InvoiceDocument, StateBadge } from "@/components/invoice-document"
import { PrintButton } from "@/components/print-button"

// The link is the credential: keep it out of search engines and other sites' logs.
export const metadata: Metadata = {
  title: "Invoice",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
}

/** The customer's view of a sent quote or invoice. No account needed; print or save as PDF. */
export default async function PublicInvoicePage({ params }: PageProps<"/i/[token]">) {
  const data = await getPublicInvoice((await params).token)
  if (!data) notFound()
  const { invoice: inv, lines, customer, orgName, settings } = data
  const state = invoiceState(inv, today())
  const showState = [
    "paid",
    "partial",
    "overdue",
    "void",
    "accepted",
    "declined",
    "expired",
  ].includes(state)

  return (
    <main className="min-h-dvh bg-muted/40 px-4 py-8 print:bg-transparent print:p-0">
      <div className="mx-auto grid max-w-3xl gap-4">
        <div className="flex items-center justify-between gap-3 print:hidden">
          {showState ? <StateBadge state={state} /> : <span />}
          <PrintButton />
        </div>
        <div className="rounded-xl border bg-background p-6 shadow-sm sm:p-10 print:border-0 print:p-0 print:shadow-none">
          {inv.status === "void" && (
            <p className="mb-6 rounded-md border border-danger/40 px-3 py-2 text-sm text-danger">
              This {inv.kind} has been voided and is no longer valid.
            </p>
          )}
          <InvoiceDocument
            doc={inv}
            lines={lines}
            from={{ name: settings.businessName ?? orgName, details: settings.businessDetails }}
            to={customer}
            instructions={settings.paymentInstructions}
            footer={settings.footer}
          />
        </div>
      </div>
    </main>
  )
}
