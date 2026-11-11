# Point of sale

A counter till for shops and cafés: scan or tap products, take cash, card or split payments, print receipts, refund, and balance the drawer at the end of each shift. Sales take stock from the register's location through the Inventory module.

## Features

- **Registers**, each selling from one stock location
- **Till screen**: barcode or SKU scan (Enter adds it), search, categories, on-hand counts, custom items, per-line discounts, walk-in or CRM customer
- **Payments**: cash with quick amounts and change, card or other with a reference, and split payments
- **Receipts**: an 80 mm-friendly page with your header and footer, ready to print
- **Refunds**: part or all of a sale, cash or card, from any register with an open shift, optionally putting items back in stock
- **Shifts**: open with a float, record cash in and out, close with a blind count. The report shows takings by tender, refunds, the drawer breakdown, and how much was short or over
- **Today**: net sales, number of sales, average sale, refunds, takings by tender and best sellers, grouped by day in your time zone
- **Settings**: currency, tax rate (included in shelf prices or added on top), the largest discount a cashier can give, receipt prefix, header and footer
- **Notifications**: owners and admins hear when a drawer closes short or over (`pos.cash_variance`)

## Integrity and security

| Risk                                | Defense                                                                                                                                               |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Charging twice                      | The till sends one random key per sale; a retry or double tap returns the first sale. Tests send the same key 5 times at once: one sale               |
| Tampered prices                     | Product lines are priced from the catalog on the server; any price the browser sends for them is ignored                                              |
| Selling stock you don't have        | Stock is issued in the same transaction under row locks; 5 buyers for the last 3 items get exactly 3 sales, and a short sale saves nothing            |
| Rewriting the till                  | Triggers refuse edits and deletes on sales, lines, payments and refunds; only refunded amounts can grow, up to what was sold. Closed shifts are final |
| Slipping a sale into a closed shift | A trigger refuses any sale, refund or cash movement on a shift that isn't open, and the close locks the shift row so nothing lands mid-count          |
| Over-refunding                      | Refunds lock the sale; quantities can't exceed what's left; the last refund of a line returns exactly what's left, so totals always reconcile         |
| Cash that isn't there               | Cash refunds and cash out can't exceed what the drawer should hold                                                                                    |
| Discounts                           | Above the settings limit only with `pos: manage`                                                                                                      |
| Other organizations' data           | Every query filters by the session's org; registers, shifts, sales, lines and refunds use composite `(…, org_id)` foreign keys                        |

Money is integer cents with exact rounding: tax is rounded once per line, so the receipt always adds up.

## Permissions

`pos: ["read", "sell", "refund", "manage"]`. Members sell and run their shift; refunds, large discounts and setup are for admins.

## Use the pieces

```ts
import { computeCart, settlePayments } from "@templates/pos/definitions" // browser-safe
import { checkout, openShift, refundSale } from "@templates/pos" // server

await openShift(ctx, registerId, { openingFloat: "100" })
const { sale, changeCents } = await checkout(ctx, {
  registerId,
  clientKey: crypto.randomUUID(),
  lines: [{ productId, quantity: "2" }],
  payments: [{ tender: "cash", amount: "20" }],
})
```

## Make it yours

- **Card terminals**: replace the "card" tender with a call to your terminal's SDK and store its transaction ID as the reference.
- **Offline mode**: queue sales in IndexedDB with their keys and send them when the connection returns; the key makes resending safe.
- **Loyalty**: link sales to CRM customers (already supported) and add points per sale.
- **Invoices for businesses**: create a paid invoice from a sale with the Invoicing module.
- **Barcode labels**: print the product barcode field from Inventory.

## Setup

`pnpm --filter @templates/db db:migrate` creates the tables and triggers. It needs the Auth, Audit log, Notifications, Inventory and CRM modules.
