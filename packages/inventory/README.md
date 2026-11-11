# Inventory

Products, the locations you keep them in, and an append-only ledger of every stock change: receive, issue, transfer and count. Low-stock alerts, a reorder list and stock value at cost.

## Features

- **Products** with SKU (unique per org, case-insensitive), barcode, category, unit (pcs, kg, L, box…), cost, price, reorder point and reorder quantity
- **Locations**: warehouses, stores, vans, shelves; archive one once it's empty
- **Stock actions** from the product page:
  - **Receive** into a location, with cost per unit and a PO reference
  - **Issue** out of a location with a reason (sold, used, damaged, expired, returned, other)
  - **Transfer** between locations, both sides in one transaction
  - **Count**: enter what's actually there; the difference goes to the ledger (a matching count is recorded too)
- **Decimal quantities** stored as whole thousandths, so 2.5 kg is exact
- **Ledger** of every movement with running balance, who and when; filters by location, type and date; formula-safe CSV export
- **Dashboard numbers**: products, stock value at cost (per currency), low and out of stock, plus a reorder list with suggested quantities
- **Alerts**: `stock.low` to owners and admins once, when a product crosses down to its reorder point
- **Audit**: catalog changes, archives and count corrections

## Integrity and security

| Risk                            | Defense                                                                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Rewriting stock history         | The `stock_movement` table is append-only: a trigger refuses UPDATE and DELETE, even from direct SQL. Mistakes are fixed with a new movement   |
| Negative or oversold stock      | Each movement locks its stock row; a database check keeps quantities ≥ 0; tests issue 8 units at once against 5 in stock and exactly 5 succeed |
| Half-done transfers             | Both sides are written in one transaction; rows are locked in a fixed order so opposite transfers can't deadlock (tested)                      |
| Levels drifting from the ledger | Levels change only inside the same transaction as their movement, and every movement stores the balance after it                               |
| Losing history by deleting      | Products with movements can only be archived; the ledger's trigger blocks the cascade                                                          |
| Other organizations' stock      | Every query filters by the session's org; levels and movements use composite `(product_id, org_id)` / `(location_id, org_id)` foreign keys     |
| Who can change counts           | Members receive, issue and transfer; counts (corrections) and the catalog need admin permissions                                               |

## Permissions

`inventory: ["read", "move", "adjust", "manage"]`. `move` covers receive, issue and transfer; `adjust` covers counts; `manage` covers products and locations.

## Use the pieces

```ts
import { formatQuantity, stockStatus } from "@templates/inventory/definitions" // browser-safe
import { issueStock, receiveStock, transferStock } from "@templates/inventory" // server

await receiveStock(ctx, productId, {
  locationId,
  quantity: "24",
  unitCost: "1.20",
  reference: "PO-2401",
})
await issueStock(ctx, productId, {
  locationId,
  quantity: "2.5",
  reason: "sold",
  reference: "INV-0042",
})
await transferStock(ctx, productId, { fromLocationId, toLocationId, quantity: "6" })
```

Each call throws `InventoryError` with field errors like `{ quantity: "Only 2 kg on hand there" }` when it can't be done.

## Make it yours

- **Sell from stock**: when an order or invoice is fulfilled, call `issueStock` with `reason: "sold"` and its number as the reference. The Orders module will do this.
- **Purchase orders**: turn `reorderList()` into a PO screen and call `receiveStock` when the delivery arrives.
- **Costing**: value is on-hand × current cost. For FIFO or average cost, use the `unitCostCents` stored on each receipt.
- **Barcode scanning**: point a scanner at the search box (it matches barcodes), or add a scan field to the stock actions.
- **Batches and expiry dates**: add a `lot` table keyed by product and location, and carry the lot on movements.

## Setup

`pnpm --filter @templates/db db:migrate` creates `product`, `location`, `stock_level` and `stock_movement`, plus the ledger trigger. It needs the Auth, Audit log and Notifications modules.
