import { sql } from "drizzle-orm"
import {
  bigint,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { organization, user } from "./auth"

const orgId = () =>
  uuid("org_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" })

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
}

export const MOVEMENT_KINDS = ["receive", "issue", "transfer_out", "transfer_in", "count"] as const

/** Something you stock. Quantities are thousandths so "2.5 kg" is exact. */
export const product = pgTable(
  "product",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category"),
    barcode: text("barcode"),
    /** e.g. "pcs", "kg", "box". */
    unit: text("unit").notNull().default("pcs"),
    currency: text("currency").notNull().default("USD"),
    costCents: bigint("cost_cents", { mode: "number" }).notNull().default(0),
    priceCents: bigint("price_cents", { mode: "number" }).notNull().default(0),
    /** Alert when total on hand falls to this or below. 0 turns alerts off. */
    reorderPointMilli: bigint("reorder_point_milli", { mode: "number" }).notNull().default(0),
    /** Suggested amount to order. */
    reorderQtyMilli: bigint("reorder_qty_milli", { mode: "number" }).notNull().default(0),
    status: text("status", { enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("product_sku_uq").on(t.orgId, sql`lower(${t.sku})`),
    index("product_org_idx").on(t.orgId, t.status, t.name),
    unique("product_id_org_uq").on(t.id, t.orgId),
  ],
)

/** A place stock is kept: a warehouse, a store, a van, a shelf. */
export const location = pgTable(
  "location",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    name: text("name").notNull(),
    address: text("address"),
    status: text("status", { enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("location_name_uq").on(t.orgId, sql`lower(${t.name})`),
    unique("location_id_org_uq").on(t.id, t.orgId),
  ],
)

/** On hand per product per location. Only ever changed together with a movement. */
export const stockLevel = pgTable(
  "stock_level",
  {
    orgId: orgId(),
    productId: uuid("product_id").notNull(),
    locationId: uuid("location_id").notNull(),
    quantityMilli: bigint("quantity_milli", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.locationId] }),
    index("stock_level_location_idx").on(t.locationId),
    foreignKey({
      name: "stock_level_product_fk",
      columns: [t.productId, t.orgId],
      foreignColumns: [product.id, product.orgId],
    }).onDelete("cascade"),
    foreignKey({
      name: "stock_level_location_fk",
      columns: [t.locationId, t.orgId],
      foreignColumns: [location.id, location.orgId],
    }).onDelete("cascade"),
  ],
)

/** The stock ledger. Append-only: corrections are new movements, never edits. */
export const stockMovement = pgTable(
  "stock_movement",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    productId: uuid("product_id").notNull(),
    locationId: uuid("location_id").notNull(),
    kind: text("kind", { enum: MOVEMENT_KINDS }).notNull(),
    /** Signed change in thousandths: +5000 received five, -1500 issued one and a half. */
    quantityMilli: bigint("quantity_milli", { mode: "number" }).notNull(),
    /** On hand at this location right after the movement. */
    balanceAfterMilli: bigint("balance_after_milli", { mode: "number" }).notNull(),
    /** Why stock left: sold, used, damaged, expired, other. */
    reason: text("reason"),
    /** Purchase order, order number, delivery note. */
    reference: text("reference"),
    note: text("note"),
    /** Cost per unit for receipts. */
    unitCostCents: bigint("unit_cost_cents", { mode: "number" }),
    /** Pairs the two sides of a transfer. */
    transferId: uuid("transfer_id"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("stock_movement_product_idx").on(t.productId, t.createdAt.desc()),
    index("stock_movement_org_idx").on(t.orgId, t.createdAt.desc()),
    foreignKey({
      name: "stock_movement_product_fk",
      columns: [t.productId, t.orgId],
      foreignColumns: [product.id, product.orgId],
    }).onDelete("cascade"),
    foreignKey({
      name: "stock_movement_location_fk",
      columns: [t.locationId, t.orgId],
      foreignColumns: [location.id, location.orgId],
    }).onDelete("cascade"),
  ],
)

export type Product = typeof product.$inferSelect
export type Location = typeof location.$inferSelect
export type StockLevel = typeof stockLevel.$inferSelect
export type StockMovement = typeof stockMovement.$inferSelect
export type MovementKind = (typeof MOVEMENT_KINDS)[number]
