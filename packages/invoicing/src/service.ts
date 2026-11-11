import "server-only"

import { randomBytes } from "node:crypto"

import { audit } from "@templates/audit"
import { db } from "@templates/db"
import {
  customer,
  type Invoice,
  invoice,
  invoiceLine,
  invoiceSettings,
  organization,
  payment,
  user,
} from "@templates/db/schema"
import { appUrl, membersWithRole, notify, renderEmail, sendEmail } from "@templates/notifications"
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  isNull,
  lt,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm"
import { z } from "zod"

import {
  addDays,
  computeTotals,
  fieldErrors,
  formatMoney,
  formatNumber,
  type InvoiceFilter,
  type InvoiceInput,
  type InvoiceKind,
  invoiceFilterSchema,
  invoiceInputSchema,
  type PaymentInput,
  paymentInputSchema,
  type SettingsInput,
  settingsInputSchema,
  today,
} from "./definitions"

export type InvoicingContext = { orgId: string; user: { id: string; name: string; email: string } }

export class InvoiceError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(message)
  }
}

export const PAGE_SIZE = 25

const isUuid = (s: string) => z.uuid().safeParse(s).success
const notFound = () => new InvoiceError("Not found", 404)
const conflict = (m: string) => new InvoiceError(m, 409)

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input)
  if (!r.success)
    throw new InvoiceError("Please fix the highlighted fields.", 400, fieldErrors(r.error))
  return r.data
}

const likeTerm = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
const label = (inv: Pick<Invoice, "kind" | "number">) =>
  inv.number ?? (inv.kind === "quote" ? "draft quote" : "draft invoice")

// ---------- Settings ----------

export async function getSettings(ctx: Pick<InvoicingContext, "orgId">) {
  await db.insert(invoiceSettings).values({ orgId: ctx.orgId }).onConflictDoNothing()
  const [row] = await db.select().from(invoiceSettings).where(eq(invoiceSettings.orgId, ctx.orgId))
  if (!row) throw new Error("settings missing")
  return row
}

export async function updateSettings(ctx: InvoicingContext, input: SettingsInput) {
  const before = await getSettings(ctx)
  const { defaultTaxRate, ...v } = parse(settingsInputSchema, input)
  // Numbers only move forward, so a number can never be handed out twice.
  const errors: Record<string, string> = {}
  if (v.nextInvoiceNumber < before.nextInvoiceNumber)
    errors.nextInvoiceNumber = `Can't go below ${before.nextInvoiceNumber}`
  if (v.nextQuoteNumber < before.nextQuoteNumber)
    errors.nextQuoteNumber = `Can't go below ${before.nextQuoteNumber}`
  if (Object.keys(errors).length)
    throw new InvoiceError("Please fix the highlighted fields.", 400, errors)
  const [row] = await db
    .update(invoiceSettings)
    .set({ ...v, defaultTaxRateBp: defaultTaxRate })
    .where(eq(invoiceSettings.orgId, ctx.orgId))
    .returning()
  await audit(ctx, "invoice_settings.updated", "Updated invoice settings")
  return row
}

// ---------- Lookups (always scoped to ctx.orgId) ----------

async function ownInvoice(ctx: Pick<InvoicingContext, "orgId">, id: string) {
  if (!isUuid(id)) throw notFound()
  const [row] = await db
    .select()
    .from(invoice)
    .where(and(eq(invoice.id, id), eq(invoice.orgId, ctx.orgId)))
  if (!row) throw notFound()
  return row
}

async function assertCustomer(ctx: Pick<InvoicingContext, "orgId">, customerId: string) {
  const [c] = await db
    .select({ id: customer.id })
    .from(customer)
    .where(and(eq(customer.id, customerId), eq(customer.orgId, ctx.orgId)))
  if (!c)
    throw new InvoiceError("Please fix the highlighted fields.", 400, {
      customerId: "Choose a customer from the list",
    })
}

/** Customers for the picker. */
export async function invoiceCustomers(ctx: Pick<InvoicingContext, "orgId">) {
  return db
    .select({ id: customer.id, name: customer.name, email: customer.email })
    .from(customer)
    .where(and(eq(customer.orgId, ctx.orgId), ne(customer.status, "inactive")))
    .orderBy(asc(customer.name))
    .limit(2000)
}

// ---------- Listing ----------

/** SQL for each list filter, matching invoiceState(). */
function stateWhere(state: string, todayStr: string): SQL | undefined {
  const balance = sql`${invoice.amountPaidCents} < ${invoice.totalCents}`
  switch (state) {
    case "draft":
    case "void":
    case "accepted":
    case "declined":
      return eq(invoice.status, state)
    case "sent":
      return eq(invoice.status, "sent")
    case "paid":
      return and(
        eq(invoice.status, "sent"),
        sql`${invoice.amountPaidCents} >= ${invoice.totalCents}`,
      )
    case "open":
      return and(
        eq(invoice.status, "sent"),
        balance,
        or(isNull(invoice.dueOn), gte(invoice.dueOn, todayStr)),
      )
    case "overdue":
      return and(eq(invoice.status, "sent"), balance, lt(invoice.dueOn, todayStr))
  }
}

export async function listInvoices(
  ctx: Pick<InvoicingContext, "orgId">,
  f: InvoiceFilter = {},
  todayStr = today(),
) {
  const filter = invoiceFilterSchema.parse(f)
  const where: SQL[] = [eq(invoice.orgId, ctx.orgId), eq(invoice.kind, filter.kind)]
  if (filter.state) {
    const s = stateWhere(filter.state, todayStr)
    if (s) where.push(s)
  }
  if (filter.customer) where.push(eq(invoice.customerId, filter.customer))
  if (filter.q) {
    const term = likeTerm(filter.q)
    const search = or(ilike(invoice.number, term), ilike(customer.name, term))
    if (search) where.push(search)
  }
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: invoice.id,
        kind: invoice.kind,
        number: invoice.number,
        status: invoice.status,
        issueDate: invoice.issueDate,
        dueOn: invoice.dueOn,
        currency: invoice.currency,
        totalCents: invoice.totalCents,
        amountPaidCents: invoice.amountPaidCents,
        customerId: invoice.customerId,
        customerName: customer.name,
      })
      .from(invoice)
      .innerJoin(customer, eq(customer.id, invoice.customerId))
      .where(and(...where))
      .orderBy(desc(invoice.issueDate), desc(invoice.createdAt))
      .limit(PAGE_SIZE)
      .offset((filter.page - 1) * PAGE_SIZE),
    db
      .select({ n: count() })
      .from(invoice)
      .innerJoin(customer, eq(customer.id, invoice.customerId))
      .where(and(...where)),
  ])
  return { rows, total: total?.n ?? 0, page: filter.page, pageSize: PAGE_SIZE, filter }
}

/** Money owed, overdue and collected in the last 30 days, per currency. */
export async function invoiceSummary(ctx: Pick<InvoicingContext, "orgId">, todayStr = today()) {
  const balance =
    sql<number>`coalesce(sum(${invoice.totalCents} - ${invoice.amountPaidCents}), 0)::bigint`.mapWith(
      Number,
    )
  const open = and(
    eq(invoice.orgId, ctx.orgId),
    eq(invoice.kind, "invoice"),
    eq(invoice.status, "sent"),
    sql`${invoice.amountPaidCents} < ${invoice.totalCents}`,
  )
  const [outstanding, overdue, collected] = await Promise.all([
    db
      .select({ currency: invoice.currency, cents: balance })
      .from(invoice)
      .where(open)
      .groupBy(invoice.currency),
    db
      .select({ currency: invoice.currency, cents: balance, n: count() })
      .from(invoice)
      .where(and(open, lt(invoice.dueOn, todayStr)))
      .groupBy(invoice.currency),
    db
      .select({
        currency: invoice.currency,
        cents: sql<number>`coalesce(sum(${payment.amountCents}), 0)::bigint`.mapWith(Number),
      })
      .from(payment)
      .innerJoin(invoice, eq(invoice.id, payment.invoiceId))
      .where(and(eq(payment.orgId, ctx.orgId), gte(payment.paidOn, addDays(todayStr, -30))))
      .groupBy(invoice.currency),
  ])
  return { outstanding, overdue, collected }
}

export async function getInvoice(ctx: Pick<InvoicingContext, "orgId">, id: string) {
  const inv = await ownInvoice(ctx, id)
  const [cust, lines, payments, settings, converted] = await Promise.all([
    db
      .select({
        id: customer.id,
        name: customer.name,
        email: customer.email,
        address: customer.address,
      })
      .from(customer)
      .where(eq(customer.id, inv.customerId))
      .then((r) => r[0] ?? null),
    db
      .select()
      .from(invoiceLine)
      .where(and(eq(invoiceLine.invoiceId, inv.id), eq(invoiceLine.orgId, ctx.orgId)))
      .orderBy(asc(invoiceLine.position)),
    db
      .select({
        id: payment.id,
        amountCents: payment.amountCents,
        paidOn: payment.paidOn,
        method: payment.method,
        reference: payment.reference,
        note: payment.note,
        recordedBy: user.name,
      })
      .from(payment)
      .leftJoin(user, eq(user.id, payment.createdBy))
      .where(and(eq(payment.invoiceId, inv.id), eq(payment.orgId, ctx.orgId)))
      .orderBy(desc(payment.paidOn), desc(payment.createdAt)),
    getSettings(ctx),
    // The invoice made from this quote, if any.
    inv.kind === "quote"
      ? db
          .select({ id: invoice.id, number: invoice.number })
          .from(invoice)
          .where(
            and(
              eq(invoice.sourceQuoteId, inv.id),
              eq(invoice.orgId, ctx.orgId),
              ne(invoice.status, "void"),
            ),
          )
          .then((r) => r[0] ?? null)
      : null,
  ])
  return { invoice: inv, customer: cust, lines, payments, settings, convertedTo: converted }
}

// ---------- Drafts ----------

function linesFrom(v: z.output<typeof invoiceInputSchema>) {
  return computeTotals(
    v.lines.map((l) => ({
      description: l.description,
      quantityMilli: l.quantity,
      unitPriceCents: l.unitPrice,
      taxRateBp: l.taxRate,
    })),
  )
}

export async function createDraft(ctx: InvoicingContext, kind: InvoiceKind, input: InvoiceInput) {
  const v = parse(invoiceInputSchema, input)
  await assertCustomer(ctx, v.customerId)
  const totals = linesFrom(v)
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(invoice)
      .values({
        orgId: ctx.orgId,
        kind,
        customerId: v.customerId,
        issueDate: v.issueDate ?? today(),
        dueOn: v.dueOn,
        currency: v.currency,
        notes: v.notes,
        terms: v.terms,
        subtotalCents: totals.subtotalCents,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
        createdBy: ctx.user.id,
      })
      .returning()
    if (!row) throw new Error("insert failed")
    await tx.insert(invoiceLine).values(
      totals.lines.map((l, position) => ({
        ...l,
        position,
        orgId: ctx.orgId,
        invoiceId: row.id,
      })),
    )
    return row
  })
}

export async function updateDraft(ctx: InvoicingContext, id: string, input: InvoiceInput) {
  const before = await ownInvoice(ctx, id)
  if (before.status !== "draft")
    throw conflict("Only drafts can be edited. Void it and make a copy instead.")
  const v = parse(invoiceInputSchema, input)
  if (v.customerId !== before.customerId) await assertCustomer(ctx, v.customerId)
  const totals = linesFrom(v)
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(invoice)
      .set({
        customerId: v.customerId,
        issueDate: v.issueDate ?? before.issueDate,
        dueOn: v.dueOn,
        currency: v.currency,
        notes: v.notes,
        terms: v.terms,
        subtotalCents: totals.subtotalCents,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
      })
      .where(and(eq(invoice.id, id), eq(invoice.orgId, ctx.orgId), eq(invoice.status, "draft")))
      .returning()
    if (!row) throw conflict("Only drafts can be edited.")
    await tx.delete(invoiceLine).where(eq(invoiceLine.invoiceId, id))
    await tx
      .insert(invoiceLine)
      .values(
        totals.lines.map((l, position) => ({ ...l, position, orgId: ctx.orgId, invoiceId: id })),
      )
    return row
  })
}

export async function deleteDraft(ctx: InvoicingContext, id: string) {
  const inv = await ownInvoice(ctx, id)
  if (inv.status !== "draft") throw conflict("Sent documents can't be deleted. Void it instead.")
  await db.delete(invoice).where(and(eq(invoice.id, id), eq(invoice.orgId, ctx.orgId)))
}

/** A new draft with the same customer and lines, dated today. */
export async function duplicateInvoice(ctx: InvoicingContext, id: string, asKind?: InvoiceKind) {
  const { invoice: src, lines, settings } = await getInvoice(ctx, id)
  const kind = asKind ?? src.kind
  const issue = today()
  const row = await createDraft(ctx, kind, {
    customerId: src.customerId,
    issueDate: issue,
    dueOn: addDays(issue, settings.defaultDueDays),
    currency: src.currency as InvoiceInput["currency"],
    notes: src.notes,
    terms: src.terms,
    lines: lines.map((l) => ({
      description: l.description,
      quantity: String(l.quantityMilli / 1000),
      unitPrice: (l.unitPriceCents / 100).toFixed(2),
      taxRate: String(l.taxRateBp / 100),
    })),
  })
  return row
}

// ---------- Sending ----------

const newToken = () => randomBytes(18).toString("base64url") // 24 chars, 144 bits

/**
 * Finalizes a draft: gives it the next number, locks it and creates the
 * customer's view link. Optionally emails the customer.
 */
export async function sendInvoice(
  ctx: InvoicingContext,
  id: string,
  opts: { email?: boolean } = {},
) {
  const draft = await ownInvoice(ctx, id)
  if (draft.status !== "draft") throw conflict("This has already been sent.")
  await getSettings(ctx)
  const isQuote = draft.kind === "quote"

  const sent = await db.transaction(async (tx) => {
    // Row-locks the settings so two sends can't take the same number.
    const [seq] = await tx
      .update(invoiceSettings)
      .set(
        isQuote
          ? { nextQuoteNumber: sql`${invoiceSettings.nextQuoteNumber} + 1` }
          : { nextInvoiceNumber: sql`${invoiceSettings.nextInvoiceNumber} + 1` },
      )
      .where(eq(invoiceSettings.orgId, ctx.orgId))
      .returning()
    if (!seq) throw new Error("settings missing")
    const n = (isQuote ? seq.nextQuoteNumber : seq.nextInvoiceNumber) - 1
    const [row] = await tx
      .update(invoice)
      .set({
        status: "sent",
        number: formatNumber(isQuote ? seq.quotePrefix : seq.invoicePrefix, n),
        // An invoice without a due date is due on receipt.
        dueOn: draft.dueOn ?? (isQuote ? null : draft.issueDate),
        sentAt: new Date(),
        publicToken: newToken(),
      })
      .where(and(eq(invoice.id, id), eq(invoice.orgId, ctx.orgId), eq(invoice.status, "draft")))
      .returning()
    if (!row) throw conflict("This has already been sent.")
    return row
  })

  await audit(ctx, `${sent.kind}.sent`, `Sent ${sent.kind} ${sent.number}`, {
    target: { type: "invoice", id },
  })
  const emailed = opts.email ? await emailCustomer(ctx, sent, "new") : false
  return { invoice: sent, emailed }
}

/** Emails a payment reminder for a sent invoice with money still owed. */
export async function remindInvoice(ctx: InvoicingContext, id: string) {
  const inv = await ownInvoice(ctx, id)
  if (inv.kind !== "invoice" || inv.status !== "sent" || inv.amountPaidCents >= inv.totalCents)
    throw conflict("Only unpaid invoices get reminders.")
  const emailed = await emailCustomer(ctx, inv, "reminder")
  if (!emailed) throw conflict("Add an email address to the customer first.")
  await audit(ctx, "invoice.reminded", `Sent a reminder for ${inv.number}`, {
    target: { type: "invoice", id },
  })
  return { emailed }
}

async function emailCustomer(ctx: InvoicingContext, inv: Invoice, why: "new" | "reminder") {
  const [[c], [org], settings] = await Promise.all([
    db
      .select({ name: customer.name, email: customer.email })
      .from(customer)
      .where(eq(customer.id, inv.customerId)),
    db.select({ name: organization.name }).from(organization).where(eq(organization.id, ctx.orgId)),
    getSettings(ctx),
  ])
  if (!c?.email || !inv.publicToken) return false
  const from = settings.businessName ?? org?.name ?? "Us"
  const kind = inv.kind === "quote" ? "quote" : "invoice"
  const owed = formatMoney(inv.totalCents - inv.amountPaidCents, inv.currency)
  const subject =
    why === "reminder"
      ? `Reminder: invoice ${inv.number} (${owed} due)`
      : `${kind === "quote" ? "Quote" : "Invoice"} ${inv.number} from ${from}`
  try {
    await sendEmail({
      to: c.email,
      ...renderEmail({
        subject,
        heading: subject,
        paragraphs: [
          `Hi ${c.name},`,
          why === "reminder"
            ? `This is a friendly reminder that ${owed} is due${inv.dueOn ? ` (due ${inv.dueOn})` : ""}.`
            : `Here is your ${kind} for ${formatMoney(inv.totalCents, inv.currency)}.`,
        ],
        action: { label: `View ${kind}`, url: appUrl(`/i/${inv.publicToken}`) },
        footer: `Sent by ${from}.`,
      }),
    })
    return true
  } catch (e) {
    console.error("[invoicing] email failed", e)
    return false
  }
}

// ---------- Quotes ----------

export async function setQuoteStatus(
  ctx: InvoicingContext,
  id: string,
  status: "accepted" | "declined",
) {
  const q = await ownInvoice(ctx, id)
  if (
    q.kind !== "quote" ||
    (q.status !== "sent" && q.status !== "accepted" && q.status !== "declined")
  )
    throw conflict("Only sent quotes can be accepted or declined.")
  if (q.status === status) return q
  const [row] = await db
    .update(invoice)
    .set({ status })
    .where(and(eq(invoice.id, id), eq(invoice.orgId, ctx.orgId)))
    .returning()
  await audit(ctx, `quote.${status}`, `Marked quote ${q.number} as ${status}`, {
    target: { type: "invoice", id },
  })
  if (status === "accepted") {
    const leads = await membersWithRole(ctx.orgId, ["owner", "admin"])
    await notify({
      orgId: ctx.orgId,
      to: [...leads, ...(q.createdBy ? [q.createdBy] : [])].filter((u) => u !== ctx.user.id),
      type: "quote.accepted",
      title: `Quote ${q.number} accepted (${formatMoney(q.totalCents, q.currency)})`,
      link: `/invoices/${id}`,
    })
  }
  return row
}

/** Turns a sent quote into a draft invoice (once). Marks the quote accepted. */
export async function convertQuote(ctx: InvoicingContext, id: string) {
  const { invoice: q, convertedTo } = await getInvoice(ctx, id)
  if (q.kind !== "quote" || (q.status !== "sent" && q.status !== "accepted"))
    throw conflict("Only sent or accepted quotes can become invoices.")
  if (convertedTo) return ownInvoice(ctx, convertedTo.id)
  const draft = await duplicateInvoice(ctx, id, "invoice")
  const [row] = await db
    .update(invoice)
    .set({ sourceQuoteId: q.id })
    .where(eq(invoice.id, draft.id))
    .returning()
  if (q.status === "sent") await setQuoteStatus(ctx, id, "accepted")
  return row ?? draft
}

// ---------- Void ----------

export async function voidInvoice(ctx: InvoicingContext, id: string) {
  const inv = await ownInvoice(ctx, id)
  if (inv.status === "draft") throw conflict("Drafts can simply be deleted.")
  if (inv.status === "void") return inv
  if (inv.amountPaidCents > 0) throw conflict("Remove its payments (refund them) before voiding.")
  const [row] = await db
    .update(invoice)
    .set({ status: "void", voidedAt: new Date() })
    .where(and(eq(invoice.id, id), eq(invoice.orgId, ctx.orgId)))
    .returning()
  await audit(ctx, `${inv.kind}.voided`, `Voided ${inv.kind} ${inv.number}`, {
    target: { type: "invoice", id },
  })
  return row
}

// ---------- Payments ----------

export async function recordPayment(ctx: InvoicingContext, invoiceId: string, input: PaymentInput) {
  await ownInvoice(ctx, invoiceId)
  const v = parse(paymentInputSchema, input)
  if (v.paidOn && v.paidOn > addDays(today(), 1))
    throw new InvoiceError("Please fix the highlighted fields.", 400, {
      paidOn: "Can't be in the future",
    })

  const result = await db.transaction(async (tx) => {
    // Lock the invoice so two payments recorded at once can't overpay it.
    const [inv] = await tx
      .select()
      .from(invoice)
      .where(and(eq(invoice.id, invoiceId), eq(invoice.orgId, ctx.orgId)))
      .for("update")
    if (!inv) throw notFound()
    if (inv.kind !== "invoice" || inv.status !== "sent")
      throw conflict("Payments go on sent invoices only.")
    const balance = inv.totalCents - inv.amountPaidCents
    if (v.amount > balance)
      throw new InvoiceError("Please fix the highlighted fields.", 400, {
        amount: `Only ${formatMoney(balance, inv.currency)} is owed`,
      })
    const [p] = await tx
      .insert(payment)
      .values({
        orgId: ctx.orgId,
        invoiceId,
        amountCents: v.amount,
        paidOn: v.paidOn ?? today(),
        method: v.method,
        reference: v.reference,
        note: v.note,
        createdBy: ctx.user.id,
      })
      .returning()
    const [updated] = await tx
      .update(invoice)
      .set({ amountPaidCents: sql`${invoice.amountPaidCents} + ${v.amount}` })
      .where(eq(invoice.id, invoiceId))
      .returning()
    return { payment: p, invoice: updated ?? inv }
  })

  const inv = result.invoice
  await audit(
    ctx,
    "payment.recorded",
    `Recorded ${formatMoney(v.amount, inv.currency)} on ${inv.number}`,
    {
      target: { type: "invoice", id: invoiceId },
    },
  )
  if (inv.amountPaidCents >= inv.totalCents) {
    const leads = await membersWithRole(ctx.orgId, ["owner", "admin"])
    await notify({
      orgId: ctx.orgId,
      to: leads.filter((u) => u !== ctx.user.id),
      type: "invoice.paid",
      title: `Paid: ${inv.number} (${formatMoney(inv.totalCents, inv.currency)})`,
      link: `/invoices/${invoiceId}`,
    })
  }
  return result
}

/** Removes a payment (e.g. recorded by mistake, or refunded). Callers check `payment: ["delete"]`. */
export async function deletePayment(ctx: InvoicingContext, paymentId: string) {
  if (!isUuid(paymentId)) throw notFound()
  const done = await db.transaction(async (tx) => {
    const [p] = await tx
      .select()
      .from(payment)
      .where(and(eq(payment.id, paymentId), eq(payment.orgId, ctx.orgId)))
    if (!p) throw notFound()
    const [inv] = await tx
      .select()
      .from(invoice)
      .where(and(eq(invoice.id, p.invoiceId), eq(invoice.orgId, ctx.orgId)))
      .for("update")
    if (!inv) throw notFound()
    await tx.delete(payment).where(eq(payment.id, p.id))
    await tx
      .update(invoice)
      .set({ amountPaidCents: sql`${invoice.amountPaidCents} - ${p.amountCents}` })
      .where(eq(invoice.id, inv.id))
    return { p, inv }
  })
  await audit(
    ctx,
    "payment.deleted",
    `Removed a ${formatMoney(done.p.amountCents, done.inv.currency)} payment from ${done.inv.number}`,
    { target: { type: "invoice", id: done.inv.id } },
  )
}

// ---------- Customer view link ----------

/**
 * A sent quote or invoice by its link, for the customer's page. No session needed:
 * the 144-bit token is the credential. Drafts and malformed links return null.
 */
export async function getPublicInvoice(token: string) {
  if (!/^[A-Za-z0-9_-]{24}$/.test(token)) return null
  const [inv] = await db
    .select()
    .from(invoice)
    .where(and(eq(invoice.publicToken, token), ne(invoice.status, "draft")))
  if (!inv) return null
  const [lines, [cust], [org], settings] = await Promise.all([
    db
      .select()
      .from(invoiceLine)
      .where(eq(invoiceLine.invoiceId, inv.id))
      .orderBy(asc(invoiceLine.position)),
    db
      .select({ name: customer.name, email: customer.email, address: customer.address })
      .from(customer)
      .where(eq(customer.id, inv.customerId)),
    db.select({ name: organization.name }).from(organization).where(eq(organization.id, inv.orgId)),
    getSettings({ orgId: inv.orgId }),
  ])
  return { invoice: inv, lines, customer: cust ?? null, orgName: org?.name ?? "", settings }
}

/** Unpaid invoices past their due date, oldest first: for a reminder job or a dashboard. */
export async function overdueInvoices(ctx: Pick<InvoicingContext, "orgId">, todayStr = today()) {
  return db
    .select({
      id: invoice.id,
      number: invoice.number,
      dueOn: invoice.dueOn,
      currency: invoice.currency,
      balanceCents: sql<number>`(${invoice.totalCents} - ${invoice.amountPaidCents})`.mapWith(
        Number,
      ),
      customerName: customer.name,
    })
    .from(invoice)
    .innerJoin(customer, eq(customer.id, invoice.customerId))
    .where(
      and(
        eq(invoice.orgId, ctx.orgId),
        eq(invoice.kind, "invoice"),
        eq(invoice.status, "sent"),
        gt(invoice.totalCents, invoice.amountPaidCents),
        lt(invoice.dueOn, todayStr),
      ),
    )
    .orderBy(asc(invoice.dueOn))
    .limit(500)
}
