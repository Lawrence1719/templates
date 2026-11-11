# Orders & sales

Take an order, confirm it, ship it from stock and invoice it, with every step on a history nobody can rewrite. Ties together the CRM (customers), Inventory (stock) and Invoicing.

## Features

- **Orders** for a customer with product lines (picked from Inventory, name and price filled in) and free lines for services or fees; per-line tax, live totals, delivery address, wanted-by date and ship-from location
- **Numbers** like `SO-0001`, assigned on creation from a row-locked counter
- **Workflow**: draft → confirmed → fulfilled, or cancelled (with a reason) before fulfillment. Drafts and confirmed orders can still be edited
- **Fulfill** takes every product line out of the chosen location in one transaction, recorded in the inventory ledger as "sold" with the order number. If anything is short, nothing changes and each short line is named
- **Create invoice**: one draft invoice per order with the same lines and totals (same money math as Invoicing); the order shows whether it's paid
- **History**: created, edited (with old and new totals), confirmed, fulfilled, cancelled, invoiced, and notes, with who and when
- **List and numbers**: filter by status or "due to ship", search by number or customer; open orders and value, orders due to ship, fulfilled value in the last 30 days (per currency)
- **Notifications**: `order.confirmed` to owners and admins, `order.cancelled` to whoever created it; low-stock alerts fire after fulfillment

## Integrity and security

| Risk                             | Defense                                                                                                                                                                     |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Changing what was sold           | A database trigger locks lines, totals, customer, location and dates once an order is fulfilled or cancelled; it can't be reopened or deleted, and numbers never change     |
| Rewriting history                | The order history is append-only in the database (only a draft's history goes when the draft is deleted)                                                                    |
| Shipping without stock, or twice | Fulfillment locks the order row and each stock row in one transaction; two orders racing for the same stock: one ships, the other gets a clear error and nothing moves      |
| Half-shipped orders              | All product lines come out together or not at all                                                                                                                           |
| Duplicate order numbers          | Row-locked counter plus a unique index; five orders created at once get five numbers                                                                                        |
| Losing records                   | Customers, products and locations used on orders can't be deleted (archive them); the CRM and Inventory explain why                                                         |
| Other organizations' data        | Every query filters by the session's org; lines and history use composite `(order_id, org_id)` foreign keys; orders can only use your own customers, products and locations |
| Who can do what                  | Members take, confirm and fulfill orders (fulfilling also needs `inventory: move`); cancelling is for admins; creating an invoice needs `invoice: write`                    |

## Permissions

`order: ["read", "write", "confirm", "fulfill", "cancel"]`.

## Use the pieces

```ts
import { confirmOrder, createOrder, fulfillOrder, invoiceOrder } from "@templates/orders"

const order = await createOrder(ctx, {
  customerId,
  orderDate: "2026-11-11",
  locationId: warehouseId,
  currency: "USD",
  lines: [{ productId: beansId, description: "House blend 1kg", quantity: "10", unitPrice: "22" }],
})
await confirmOrder(ctx, order.id)
await fulfillOrder(ctx, order.id) // stock out, in one transaction
const invoice = await invoiceOrder(ctx, order.id) // draft invoice, same totals
```

## Make it yours

- **Partial shipments**: add a `shipment` table with its own lines and fulfill per shipment instead of per order.
- **Returns**: record a receive (reason "returned") against the order number, and a credit on the invoice.
- **Online orders**: create orders from your storefront or a public form, as drafts for staff to confirm.
- **Order numbers**: change the prefix in `order_settings` (for example `WEB-`), or add a settings page.
- **Delivery tracking**: add a carrier and tracking number, filled in when fulfilling.

## Setup

`pnpm --filter @templates/db db:migrate` creates `order_settings`, `sales_order`, `sales_order_line` and `sales_order_event`, plus the locking triggers. It needs the CRM, Inventory, Invoicing, Auth and Notifications modules.
