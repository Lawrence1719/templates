# Invoicing & payments

Quotes, invoices, payments and a link customers can open, print or save as PDF. Built on the CRM's customers.

## Features

- **Quotes and invoices** with line items: description, quantity (decimals allowed), price (negative for discounts) and a tax rate per line; live totals while editing
- **Numbering** like `INV-0001` and `QUO-0001`, assigned when a document is sent so drafts never use up a number; prefixes and the next number are configurable (forward only)
- **Send by email** with a link, or finalize and share the link yourself; the customer's page at `/i/<link>` needs no account and prints cleanly
- **Payments**: record full or partial payments by cash, transfer, card or check; overpaying is refused; remove a payment to refund it
- **States worked out from the money**: Open, Partly paid, Overdue, Paid, Void for invoices; Sent, Accepted, Declined, Expired for quotes
- **Quote → invoice** in one click (once per quote), duplicate any document, void instead of delete
- **Reminders** for unpaid invoices, and `overdueInvoices()` for a daily reminder job
- **Summary**: outstanding, overdue and collected in the last 30 days, per currency (currencies are never added together)
- **Settings**: business name and details, payment instructions, footer, default tax rate, due days and currency
- **Notifications**: `invoice.paid` and `quote.accepted`. **Audit**: send, remind, void, payments, settings

## Integrity and security

| Risk                                 | Defense                                                                                                                                                                                                              |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rewriting what a customer was billed | A database trigger locks lines, totals, customer, number and dates once a document leaves draft, and refuses deleting it. Even a bug or a stolen app credential can't change a sent invoice; void and copy instead   |
| Money rounding errors                | Money is whole cents, quantities whole thousandths, tax whole basis points; line math uses exact integer (BigInt) arithmetic, rounded half away from zero per line. The editor uses the same functions as the server |
| Duplicate invoice numbers            | Numbers come from a row-locked counter inside the send transaction, plus a unique index; tests send six at once and get six different numbers                                                                        |
| Overpayment                          | The invoice row is locked while a payment is recorded; a database check keeps paid ≤ total; tests record five payments at once and only one fits                                                                     |
| Losing financial records             | A customer with invoices can't be deleted (the CRM explains why); invoices can't be deleted once sent                                                                                                                |
| Other organizations' data            | Every query filters by the session's org; lines and payments use composite `(invoice_id, org_id)` foreign keys; you can only bill your own customers                                                                 |
| Guessing customer links              | 144-bit random links; drafts and bad links return 404; pages are `noindex` and `no-referrer` so the link doesn't leak to other sites                                                                                 |
| Who can move money                   | Members can see invoices and prepare drafts; sending, voiding, recording payments and settings are admin permissions                                                                                                 |

## Permissions

`invoice: ["read", "write", "send", "void", "settings"]`, `payment: ["record", "delete"]`.

## Use the pieces

```ts
import { computeTotals, formatMoney, invoiceState } from "@templates/invoicing/definitions" // browser-safe
import { createDraft, recordPayment, sendInvoice } from "@templates/invoicing" // server

const draft = await createDraft(ctx, "invoice", {
  customerId,
  issueDate: "2026-11-11",
  dueOn: "2026-12-11",
  currency: "USD",
  lines: [{ description: "Consulting", quantity: "10", unitPrice: "150", taxRate: "12" }],
})
const { invoice } = await sendInvoice(ctx, draft.id, { email: true }) // invoice.number === "INV-0001"
await recordPayment(ctx, invoice.id, {
  amount: "1680",
  paidOn: "2026-11-20",
  method: "bank_transfer",
})
```

## Make it yours

- **Online payments**: add a "Pay now" button on `/i/[token]` that creates a Stripe Checkout session, and call `recordPayment` from the webhook.
- **PDF files**: the customer page is print-ready; for attachments, render it with a headless browser in a background job.
- **Taxes**: per-line rates cover VAT/GST/sales tax; for compound or withholding taxes, extend `computeTotals()` (and its tests).
- **Numbering per year** (`INV-2026-0001`): change `formatNumber()` and reset the counter in settings each January.

## Setup

`pnpm --filter @templates/db db:migrate` creates `invoice_settings`, `invoice`, `invoice_line` and `payment`, plus the locking triggers. It needs the CRM, Auth, Audit log and Notifications modules. Emails go out through the Notifications module (Resend, or the dev outbox when no key is set).
