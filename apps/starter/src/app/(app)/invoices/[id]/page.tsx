import { auth } from "@templates/auth"
import { can, requirePermission } from "@templates/auth/guards"
import {
  centsToInput,
  formatMoney,
  getInvoice,
  InvoiceError,
  invoiceCustomers,
  invoiceState,
  METHOD_LABELS,
  today,
} from "@templates/invoicing"
import { appUrl } from "@templates/notifications"
import { Card } from "@templates/ui/card"
import type { Metadata } from "next"
import { headers } from "next/headers"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { formatDay, InvoiceDocument, StateBadge } from "@/components/invoice-document"
import {
  DeletePaymentButton,
  DocumentActions,
  InvoiceEditor,
  PaymentForm,
} from "@/components/invoicing"

export const metadata: Metadata = { title: "Invoice" }

export default async function InvoicePage({ params }: PageProps<"/invoices/[id]">) {
  const { id } = await params
  const ctx = await requirePermission({ invoice: ["read"] }).catch(() => redirect("/dashboard"))
  const data = await getInvoice(ctx, id).catch((e) => {
    if (e instanceof InvoiceError) notFound()
    throw e
  })
  const { invoice: inv, customer, lines, payments, settings, convertedTo } = data
  const [canWrite, canSend, canVoid, canRecord, canDeletePayment, org] = await Promise.all([
    can({ invoice: ["write"] }),
    can({ invoice: ["send"] }),
    can({ invoice: ["void"] }),
    can({ payment: ["record"] }),
    can({ payment: ["delete"] }),
    auth.api.getFullOrganization({ headers: await headers() }).catch(() => null),
  ])
  const t = today()
  const state = invoiceState(inv, t)
  const isDraft = inv.status === "draft"
  const balance = inv.totalCents - inv.amountPaidCents
  const kindLabel = inv.kind === "quote" ? "Quote" : "Invoice"

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <Link
            href={inv.kind === "quote" ? "/invoices?kind=quote" : "/invoices"}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← {inv.kind === "quote" ? "Quotes" : "Invoices"}
          </Link>
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">
            {inv.number ? `${kindLabel} ${inv.number}` : `Draft ${kindLabel.toLowerCase()}`}
            <StateBadge state={state} />
          </h1>
          {customer && (
            <Link
              href={`/customers/${customer.id}`}
              className="text-sm text-muted-foreground hover:underline"
            >
              {customer.name}
            </Link>
          )}
        </div>
        <DocumentActions
          id={inv.id}
          kind={inv.kind}
          state={state}
          number={inv.number}
          hasEmail={!!customer?.email}
          shareUrl={inv.publicToken ? appUrl(`/i/${inv.publicToken}`) : null}
          convertedToId={convertedTo?.id ?? null}
          can={{ send: canSend, void: canVoid, write: canWrite }}
        />
      </div>

      {isDraft && canWrite ? (
        <Card>
          <InvoiceEditor
            key={inv.updatedAt.toISOString()}
            id={inv.id}
            kind={inv.kind}
            customers={await invoiceCustomers(ctx)}
            defaultTaxRate={String(settings.defaultTaxRateBp / 100)}
            canDelete
            initial={{
              customerId: inv.customerId,
              issueDate: inv.issueDate,
              dueOn: inv.dueOn ?? "",
              currency: inv.currency,
              notes: inv.notes ?? "",
              terms: inv.terms ?? "",
              lines: lines.map((l) => ({
                description: l.description,
                quantity: String(l.quantityMilli / 1000),
                unitPrice: centsToInput(l.unitPriceCents),
                taxRate: String(l.taxRateBp / 100),
              })),
            }}
          />
        </Card>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Card className="p-6 sm:p-8">
            <InvoiceDocument
              doc={inv}
              lines={lines}
              from={{
                name: settings.businessName ?? org?.name ?? "",
                details: settings.businessDetails,
              }}
              to={customer}
              instructions={settings.paymentInstructions}
              footer={settings.footer}
            />
          </Card>

          {inv.kind === "invoice" && (
            <Card className="grid gap-4 p-5">
              <div>
                <h2 className="text-sm font-semibold">Payments</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatMoney(inv.amountPaidCents, inv.currency)} of{" "}
                  {formatMoney(inv.totalCents, inv.currency)} paid
                </p>
              </div>
              {payments.length > 0 && (
                <ul className="grid gap-2">
                  {payments.map((p) => (
                    <li key={p.id} className="flex items-start gap-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium tabular-nums">
                          {formatMoney(p.amountCents, inv.currency)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDay(p.paidOn)} · {METHOD_LABELS[p.method]}
                          {p.reference && ` · ${p.reference}`}
                        </p>
                      </div>
                      {canDeletePayment && <DeletePaymentButton id={p.id} />}
                    </li>
                  ))}
                </ul>
              )}
              {inv.status === "sent" && balance > 0 && canRecord && (
                <div className="border-t pt-4">
                  <PaymentForm invoiceId={inv.id} balance={balance} currency={inv.currency} />
                </div>
              )}
              {inv.status === "sent" && balance <= 0 && (
                <p className="text-sm text-success">Paid in full.</p>
              )}
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
