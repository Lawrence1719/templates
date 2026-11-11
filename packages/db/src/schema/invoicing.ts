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

const orgId = () =>
  uuid("org_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" })

export const INVOICE_KINDS = ["quote", "invoice"] as const
/**
 * Stored status. Paid, partly paid and overdue are worked out from the
 * amounts and due date, so they can never disagree with the payments.
 */
export const INVOICE_STATUSES = ["draft", "sent", "accepted", "declined", "void"] as const
export const PAYMENT_METHODS = ["cash", "bank_transfer", "card", "check", "other"] as const

/** One row per organization: numbering, defaults and what goes on the document. */
export const invoiceSettings = pgTable("invoice_settings", {
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  invoicePrefix: text("invoice_prefix").notNull().default("INV-"),
  quotePrefix: text("quote_prefix").notNull().default("QUO-"),
  nextInvoiceNumber: integer("next_invoice_number").notNull().default(1),
  nextQuoteNumber: integer("next_quote_number").notNull().default(1),
  defaultDueDays: integer("default_due_days").notNull().default(30),
  /** Basis points: 1200 = 12%. */
  defaultTaxRateBp: integer("default_tax_rate_bp").notNull().default(0),
  defaultCurrency: text("default_currency").notNull().default("USD"),
  businessName: text("business_name"),
  businessDetails: text("business_details"),
  paymentInstructions: text("payment_instructions"),
  footer: text("footer"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
})

/** A quote or an invoice. Lines, totals and dates are locked once it leaves draft. */
export const invoice = pgTable(
  "invoice",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    kind: text("kind", { enum: INVOICE_KINDS }).notNull(),
    /** Assigned when sent, so drafts never use up a number. */
    number: text("number"),
    status: text("status", { enum: INVOICE_STATUSES }).notNull().default("draft"),
    customerId: uuid("customer_id").notNull(),
    issueDate: date("issue_date").notNull(),
    /** Due date for invoices, "valid until" for quotes. */
    dueOn: date("due_on"),
    currency: text("currency").notNull(),
    subtotalCents: bigint("subtotal_cents", { mode: "number" }).notNull().default(0),
    taxCents: bigint("tax_cents", { mode: "number" }).notNull().default(0),
    totalCents: bigint("total_cents", { mode: "number" }).notNull().default(0),
    /** Kept equal to the sum of payments, updated in the same transaction. */
    amountPaidCents: bigint("amount_paid_cents", { mode: "number" }).notNull().default(0),
    notes: text("notes"),
    terms: text("terms"),
    /** Unguessable ID for the customer's view link. Set when sent. */
    publicToken: text("public_token").unique(),
    /** The quote this invoice was made from. */
    sourceQuoteId: uuid("source_quote_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index("invoice_org_idx").on(t.orgId, t.kind, t.issueDate.desc()),
    index("invoice_customer_idx").on(t.customerId),
    uniqueIndex("invoice_number_uq")
      .on(t.orgId, t.kind, t.number)
      .where(sql`${t.number} is not null`),
    unique("invoice_id_org_uq").on(t.id, t.orgId),
    // Financial records outlive casual deletes: a customer with invoices can't be deleted.
    foreignKey({
      name: "invoice_customer_fk",
      columns: [t.customerId, t.orgId],
      foreignColumns: [customer.id, customer.orgId],
    }).onDelete("no action"),
  ],
)

export const invoiceLine = pgTable(
  "invoice_line",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    invoiceId: uuid("invoice_id").notNull(),
    position: integer("position").notNull(),
    description: text("description").notNull(),
    /** Thousandths: 1500 = 1.5 units. Whole numbers only, no float drift. */
    quantityMilli: bigint("quantity_milli", { mode: "number" }).notNull(),
    unitPriceCents: bigint("unit_price_cents", { mode: "number" }).notNull(),
    taxRateBp: integer("tax_rate_bp").notNull().default(0),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    taxCents: bigint("tax_cents", { mode: "number" }).notNull(),
  },
  (t) => [
    index("invoice_line_invoice_idx").on(t.invoiceId, t.position),
    foreignKey({
      name: "invoice_line_invoice_fk",
      columns: [t.invoiceId, t.orgId],
      foreignColumns: [invoice.id, invoice.orgId],
    }).onDelete("cascade"),
  ],
)

export const payment = pgTable(
  "payment",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    invoiceId: uuid("invoice_id").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    paidOn: date("paid_on").notNull(),
    method: text("method", { enum: PAYMENT_METHODS }).notNull(),
    reference: text("reference"),
    note: text("note"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("payment_invoice_idx").on(t.invoiceId),
    index("payment_org_idx").on(t.orgId, t.paidOn),
    foreignKey({
      name: "payment_invoice_fk",
      columns: [t.invoiceId, t.orgId],
      foreignColumns: [invoice.id, invoice.orgId],
    }).onDelete("cascade"),
  ],
)

export type InvoiceSettings = typeof invoiceSettings.$inferSelect
export type Invoice = typeof invoice.$inferSelect
export type InvoiceKind = (typeof INVOICE_KINDS)[number]
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]
export type InvoiceLine = typeof invoiceLine.$inferSelect
export type Payment = typeof payment.$inferSelect
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]
