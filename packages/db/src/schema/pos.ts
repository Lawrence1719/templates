import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
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

const orgId = () =>
  uuid("org_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" })

export const POS_TENDERS = ["cash", "card", "other"] as const
export const CASH_MOVEMENT_KINDS = ["paid_in", "paid_out"] as const

/** Per-org till settings and the receipt counter. */
export const posSettings = pgTable("pos_settings", {
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  receiptPrefix: text("receipt_prefix").notNull().default("R-"),
  nextNumber: integer("next_number").notNull().default(1),
  currency: text("currency").notNull().default("USD"),
  /** Applied to every line, in basis points (1200 = 12%). */
  taxRateBp: integer("tax_rate_bp").notNull().default(0),
  /** True when shelf prices already include tax (common for VAT). */
  pricesIncludeTax: boolean("prices_include_tax").notNull().default(true),
  /** The largest line discount a cashier can give without `pos: manage`, in basis points. */
  maxDiscountBp: integer("max_discount_bp").notNull().default(1000),
  /** Used to group sales by day. */
  timeZone: text("time_zone").notNull().default("UTC"),
  receiptHeader: text("receipt_header"),
  receiptFooter: text("receipt_footer"),
})

/** A till. Sells from one inventory location. */
export const posRegister = pgTable(
  "pos_register",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    name: text("name").notNull(),
    locationId: uuid("location_id").notNull(),
    status: text("status", { enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("pos_register_name_uq").on(t.orgId, sql`lower(${t.name})`),
    unique("pos_register_id_org_uq").on(t.id, t.orgId),
    foreignKey({
      name: "pos_register_location_fk",
      columns: [t.locationId, t.orgId],
      foreignColumns: [location.id, location.orgId],
    }).onDelete("no action"),
  ],
)

/** One cashier session on a register, from opening float to cash count. */
export const posShift = pgTable(
  "pos_shift",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    registerId: uuid("register_id").notNull(),
    status: text("status", { enum: ["open", "closed"] })
      .notNull()
      .default("open"),
    openingFloatCents: bigint("opening_float_cents", { mode: "number" }).notNull(),
    openedBy: uuid("opened_by").references(() => user.id, { onDelete: "set null" }),
    openedAt: timestamp("opened_at", { withTimezone: true }).defaultNow().notNull(),
    /** What should be in the drawer, worked out when it's closed. */
    expectedCashCents: bigint("expected_cash_cents", { mode: "number" }),
    countedCashCents: bigint("counted_cash_cents", { mode: "number" }),
    /** Counted minus expected: negative means cash is missing. */
    varianceCents: bigint("variance_cents", { mode: "number" }),
    closingNote: text("closing_note"),
    closedBy: uuid("closed_by").references(() => user.id, { onDelete: "set null" }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    // One open shift per register.
    uniqueIndex("pos_shift_open_uq").on(t.registerId).where(sql`${t.status} = 'open'`),
    index("pos_shift_org_idx").on(t.orgId, t.openedAt.desc()),
    unique("pos_shift_id_org_uq").on(t.id, t.orgId),
    foreignKey({
      name: "pos_shift_register_fk",
      columns: [t.registerId, t.orgId],
      foreignColumns: [posRegister.id, posRegister.orgId],
    }).onDelete("no action"),
  ],
)

/** Cash put into or taken out of the drawer outside a sale. Append-only. */
export const posCashMovement = pgTable(
  "pos_cash_movement",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    shiftId: uuid("shift_id").notNull(),
    kind: text("kind", { enum: CASH_MOVEMENT_KINDS }).notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("pos_cash_movement_shift_idx").on(t.shiftId, t.createdAt),
    foreignKey({
      name: "pos_cash_movement_shift_fk",
      columns: [t.shiftId, t.orgId],
      foreignColumns: [posShift.id, posShift.orgId],
    }).onDelete("cascade"),
  ],
)

/** A completed sale. Never edited: refunds are separate records. */
export const posSale = pgTable(
  "pos_sale",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    number: text("number").notNull(),
    /** Sent by the till so a double tap or a retry can't charge twice. */
    clientKey: uuid("client_key").notNull(),
    shiftId: uuid("shift_id").notNull(),
    registerId: uuid("register_id").notNull(),
    customerId: uuid("customer_id"),
    currency: text("currency").notNull(),
    /** Shelf price × quantity, before discounts (tax included when prices include it). */
    subtotalCents: bigint("subtotal_cents", { mode: "number" }).notNull(),
    discountCents: bigint("discount_cents", { mode: "number" }).notNull(),
    taxCents: bigint("tax_cents", { mode: "number" }).notNull(),
    totalCents: bigint("total_cents", { mode: "number" }).notNull(),
    /** Money given back so far. Only ever grows, up to the total. */
    refundedCents: bigint("refunded_cents", { mode: "number" }).notNull().default(0),
    note: text("note"),
    cashierId: uuid("cashier_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("pos_sale_number_uq").on(t.orgId, t.number),
    uniqueIndex("pos_sale_client_key_uq").on(t.orgId, t.clientKey),
    index("pos_sale_org_idx").on(t.orgId, t.createdAt.desc()),
    index("pos_sale_shift_idx").on(t.shiftId),
    index("pos_sale_customer_idx").on(t.customerId),
    unique("pos_sale_id_org_uq").on(t.id, t.orgId),
    foreignKey({
      name: "pos_sale_shift_fk",
      columns: [t.shiftId, t.orgId],
      foreignColumns: [posShift.id, posShift.orgId],
    }).onDelete("no action"),
    foreignKey({
      name: "pos_sale_register_fk",
      columns: [t.registerId, t.orgId],
      foreignColumns: [posRegister.id, posRegister.orgId],
    }).onDelete("no action"),
    foreignKey({
      name: "pos_sale_customer_fk",
      columns: [t.customerId, t.orgId],
      foreignColumns: [customer.id, customer.orgId],
    }).onDelete("no action"),
  ],
)

export const posSaleLine = pgTable(
  "pos_sale_line",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    saleId: uuid("sale_id").notNull(),
    position: integer("position").notNull(),
    /** Null for a custom item typed in at the till. */
    productId: uuid("product_id"),
    description: text("description").notNull(),
    quantityMilli: bigint("quantity_milli", { mode: "number" }).notNull(),
    /** The shelf price at the time of sale. */
    unitPriceCents: bigint("unit_price_cents", { mode: "number" }).notNull(),
    discountBp: integer("discount_bp").notNull().default(0),
    discountCents: bigint("discount_cents", { mode: "number" }).notNull(),
    taxRateBp: integer("tax_rate_bp").notNull(),
    taxCents: bigint("tax_cents", { mode: "number" }).notNull(),
    /** What the customer pays for this line, tax included. */
    totalCents: bigint("total_cents", { mode: "number" }).notNull(),
    refundedQtyMilli: bigint("refunded_qty_milli", { mode: "number" }).notNull().default(0),
    refundedCents: bigint("refunded_cents", { mode: "number" }).notNull().default(0),
  },
  (t) => [
    index("pos_sale_line_sale_idx").on(t.saleId, t.position),
    index("pos_sale_line_product_idx").on(t.productId),
    unique("pos_sale_line_id_org_uq").on(t.id, t.orgId),
    foreignKey({
      name: "pos_sale_line_sale_fk",
      columns: [t.saleId, t.orgId],
      foreignColumns: [posSale.id, posSale.orgId],
    }).onDelete("cascade"),
    foreignKey({
      name: "pos_sale_line_product_fk",
      columns: [t.productId, t.orgId],
      foreignColumns: [product.id, product.orgId],
    }).onDelete("no action"),
  ],
)

/** How a sale was paid. Several per sale for split payments. Append-only. */
export const posPayment = pgTable(
  "pos_payment",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    saleId: uuid("sale_id").notNull(),
    tender: text("tender", { enum: POS_TENDERS }).notNull(),
    /** What this payment put toward the sale (cash: handed over minus change). */
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    tenderedCents: bigint("tendered_cents", { mode: "number" }).notNull(),
    changeCents: bigint("change_cents", { mode: "number" }).notNull().default(0),
    /** Card slip or transfer reference. */
    reference: text("reference"),
  },
  (t) => [
    index("pos_payment_sale_idx").on(t.saleId),
    foreignKey({
      name: "pos_payment_sale_fk",
      columns: [t.saleId, t.orgId],
      foreignColumns: [posSale.id, posSale.orgId],
    }).onDelete("cascade"),
  ],
)

/** Money given back for some or all of a sale. Append-only. */
export const posRefund = pgTable(
  "pos_refund",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    saleId: uuid("sale_id").notNull(),
    /** The shift whose drawer paid out a cash refund. */
    shiftId: uuid("shift_id").notNull(),
    tender: text("tender", { enum: POS_TENDERS }).notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    reason: text("reason").notNull(),
    /** Whether the items went back on the shelf. */
    restocked: boolean("restocked").notNull(),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("pos_refund_sale_idx").on(t.saleId),
    index("pos_refund_shift_idx").on(t.shiftId),
    unique("pos_refund_id_org_uq").on(t.id, t.orgId),
    foreignKey({
      name: "pos_refund_sale_fk",
      columns: [t.saleId, t.orgId],
      foreignColumns: [posSale.id, posSale.orgId],
    }).onDelete("cascade"),
    foreignKey({
      name: "pos_refund_shift_fk",
      columns: [t.shiftId, t.orgId],
      foreignColumns: [posShift.id, posShift.orgId],
    }).onDelete("no action"),
  ],
)

export const posRefundLine = pgTable(
  "pos_refund_line",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    refundId: uuid("refund_id").notNull(),
    saleLineId: uuid("sale_line_id").notNull(),
    quantityMilli: bigint("quantity_milli", { mode: "number" }).notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  },
  (t) => [
    index("pos_refund_line_refund_idx").on(t.refundId),
    foreignKey({
      name: "pos_refund_line_refund_fk",
      columns: [t.refundId, t.orgId],
      foreignColumns: [posRefund.id, posRefund.orgId],
    }).onDelete("cascade"),
    foreignKey({
      name: "pos_refund_line_sale_line_fk",
      columns: [t.saleLineId, t.orgId],
      foreignColumns: [posSaleLine.id, posSaleLine.orgId],
    }).onDelete("cascade"),
  ],
)

export type PosSettings = typeof posSettings.$inferSelect
export type PosRegister = typeof posRegister.$inferSelect
export type PosShift = typeof posShift.$inferSelect
export type PosSale = typeof posSale.$inferSelect
export type PosSaleLine = typeof posSaleLine.$inferSelect
export type PosPayment = typeof posPayment.$inferSelect
export type PosRefund = typeof posRefund.$inferSelect
export type PosTender = (typeof POS_TENDERS)[number]
