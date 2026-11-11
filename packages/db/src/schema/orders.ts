import { sql } from "drizzle-orm"
import {
  bigint,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { organization, user } from "./auth"
import { customer } from "./crm"
import { location, product } from "./inventory"
import { invoice } from "./invoicing"

const orgId = () =>
  uuid("org_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" })

export const ORDER_STATUSES = ["draft", "confirmed", "fulfilled", "cancelled"] as const
export const ORDER_EVENT_KINDS = [
  "created",
  "edited",
  "confirmed",
  "fulfilled",
  "cancelled",
  "invoiced",
  "note",
] as const

/** Per-org order numbering. */
export const orderSettings = pgTable("order_settings", {
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  prefix: text("prefix").notNull().default("SO-"),
  nextNumber: integer("next_number").notNull().default(1),
})

export const salesOrder = pgTable(
  "sales_order",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    /** Assigned when the order is created, from a row-locked counter. */
    number: text("number").notNull(),
    status: text("status", { enum: ORDER_STATUSES }).notNull().default("draft"),
    customerId: uuid("customer_id").notNull(),
    orderDate: date("order_date").notNull(),
    /** When the customer wants it. */
    requestedOn: date("requested_on"),
    /** Where stock is taken from when the order is fulfilled. */
    locationId: uuid("location_id"),
    currency: text("currency").notNull(),
    subtotalCents: bigint("subtotal_cents", { mode: "number" }).notNull().default(0),
    taxCents: bigint("tax_cents", { mode: "number" }).notNull().default(0),
    totalCents: bigint("total_cents", { mode: "number" }).notNull().default(0),
    shippingAddress: text("shipping_address"),
    notes: text("notes"),
    /** The invoice made from this order. */
    invoiceId: uuid("invoice_id"),
    cancelReason: text("cancel_reason"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("sales_order_number_uq").on(t.orgId, t.number),
    index("sales_order_org_idx").on(t.orgId, t.status, t.orderDate.desc()),
    index("sales_order_customer_idx").on(t.customerId),
    unique("sales_order_id_org_uq").on(t.id, t.orgId),
    foreignKey({
      name: "sales_order_customer_fk",
      columns: [t.customerId, t.orgId],
      foreignColumns: [customer.id, customer.orgId],
    }).onDelete("no action"),
    foreignKey({
      name: "sales_order_location_fk",
      columns: [t.locationId, t.orgId],
      foreignColumns: [location.id, location.orgId],
    }).onDelete("no action"),
    foreignKey({
      name: "sales_order_invoice_fk",
      columns: [t.invoiceId, t.orgId],
      foreignColumns: [invoice.id, invoice.orgId],
    }).onDelete("no action"),
  ],
)

export const salesOrderLine = pgTable(
  "sales_order_line",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    orderId: uuid("order_id").notNull(),
    position: integer("position").notNull(),
    /** Optional: lines without a product (services, fees) don't touch stock. */
    productId: uuid("product_id"),
    description: text("description").notNull(),
    quantityMilli: bigint("quantity_milli", { mode: "number" }).notNull(),
    unitPriceCents: bigint("unit_price_cents", { mode: "number" }).notNull(),
    taxRateBp: integer("tax_rate_bp").notNull().default(0),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    taxCents: bigint("tax_cents", { mode: "number" }).notNull(),
  },
  (t) => [
    index("sales_order_line_order_idx").on(t.orderId, t.position),
    foreignKey({
      name: "sales_order_line_order_fk",
      columns: [t.orderId, t.orgId],
      foreignColumns: [salesOrder.id, salesOrder.orgId],
    }).onDelete("cascade"),
    foreignKey({
      name: "sales_order_line_product_fk",
      columns: [t.productId, t.orgId],
      foreignColumns: [product.id, product.orgId],
    }).onDelete("no action"),
  ],
)

/** The order's history: every step, who took it and when. Append-only. */
export const salesOrderEvent = pgTable(
  "sales_order_event",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    orderId: uuid("order_id").notNull(),
    kind: text("kind", { enum: ORDER_EVENT_KINDS }).notNull(),
    body: text("body").notNull(),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("sales_order_event_order_idx").on(t.orderId, t.createdAt),
    foreignKey({
      name: "sales_order_event_order_fk",
      columns: [t.orderId, t.orgId],
      foreignColumns: [salesOrder.id, salesOrder.orgId],
    }).onDelete("cascade"),
  ],
)

export type SalesOrder = typeof salesOrder.$inferSelect
export type SalesOrderLine = typeof salesOrderLine.$inferSelect
export type SalesOrderEvent = typeof salesOrderEvent.$inferSelect
export type OrderStatus = (typeof ORDER_STATUSES)[number]
