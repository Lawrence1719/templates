import "server-only"

import { db } from "@templates/db"
import {
  customer,
  invoice,
  location,
  orderSettings,
  product,
  type SalesOrder,
  salesOrder,
  salesOrderEvent,
  salesOrderLine,
  stockLevel,
  user,
} from "@templates/db/schema"
import { InventoryError, issueMany, sendLowStockAlerts } from "@templates/inventory"
import {
  createDraft as createInvoiceDraft,
  getSettings as getInvoiceSettings,
} from "@templates/invoicing"
import { membersWithRole, notify } from "@templates/notifications"
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  lte,
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
  isEditable,
  noteSchema,
  type OrderFilter,
  type OrderInput,
  type OrderStatus,
  orderFilterSchema,
  orderInputSchema,
  reasonSchema,
  STATUS_LABELS,
  today,
} from "./definitions"

export type OrdersContext = { orgId: string; user: { id: string; name: string; email: string } }

export class OrderError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(message)
  }
}

export const PAGE_SIZE = 25

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

const isUuid = (s: string) => z.uuid().safeParse(s).success
const notFound = () => new OrderError("Not found", 404)
const conflict = (m: string) => new OrderError(m, 409)
const invalid = (fe: Record<string, string>) =>
  new OrderError("Please fix the highlighted fields.", 400, fe)

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input)
  if (!r.success) throw invalid(fieldErrors(r.error))
  return r.data
}

const likeTerm = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

async function ownOrder(ctx: Pick<OrdersContext, "orgId">, id: string) {
  if (!isUuid(id)) throw notFound()
  const [row] = await db
    .select()
    .from(salesOrder)
    .where(and(eq(salesOrder.id, id), eq(salesOrder.orgId, ctx.orgId)))
  if (!row) throw notFound()
  return row
}

function event(
  tx: Tx | typeof db,
  ctx: OrdersContext,
  orderId: string,
  kind: (typeof salesOrderEvent.$inferInsert)["kind"],
  body: string,
) {
  return tx
    .insert(salesOrderEvent)
    .values({ orgId: ctx.orgId, orderId, kind, body, createdBy: ctx.user.id })
}

// ---------- Validation against the org's own records ----------

async function checkReferences(
  ctx: Pick<OrdersContext, "orgId">,
  v: z.output<typeof orderInputSchema>,
) {
  const errors: Record<string, string> = {}
  const [c] = await db
    .select({ id: customer.id })
    .from(customer)
    .where(and(eq(customer.id, v.customerId), eq(customer.orgId, ctx.orgId)))
  if (!c) errors.customerId = "Choose a customer from the list"
  if (v.locationId) {
    const [l] = await db
      .select({ status: location.status })
      .from(location)
      .where(and(eq(location.id, v.locationId), eq(location.orgId, ctx.orgId)))
    if (!l) errors.locationId = "Choose a location from the list"
    else if (l.status !== "active") errors.locationId = "That location is archived"
  }
  const ids = [...new Set(v.lines.map((l) => l.productId).filter((x): x is string => !!x))]
  if (ids.length) {
    const found = new Map(
      (
        await db
          .select({ id: product.id, status: product.status })
          .from(product)
          .where(and(eq(product.orgId, ctx.orgId), inArray(product.id, ids)))
      ).map((p) => [p.id, p.status]),
    )
    v.lines.forEach((l, i) => {
      if (!l.productId) return
      const s = found.get(l.productId)
      if (!s) errors[`lines.${i}.productId`] = "Choose a product from the list"
      else if (s !== "active") errors[`lines.${i}.productId`] = "That product is archived"
    })
  }
  if (Object.keys(errors).length) throw invalid(errors)
}

function totalsFor(v: z.output<typeof orderInputSchema>) {
  return computeTotals(
    v.lines.map((l) => ({
      productId: l.productId,
      description: l.description,
      quantityMilli: l.quantity,
      unitPriceCents: l.unitPrice,
      taxRateBp: l.taxRate,
    })),
  )
}

async function nextNumber(tx: Tx, orgId: string) {
  await tx.insert(orderSettings).values({ orgId }).onConflictDoNothing()
  // The row lock serializes concurrent orders, so numbers never repeat.
  const [s] = await tx
    .update(orderSettings)
    .set({ nextNumber: sql`${orderSettings.nextNumber} + 1` })
    .where(eq(orderSettings.orgId, orgId))
    .returning()
  if (!s) throw new Error("order settings missing")
  return `${s.prefix}${String(s.nextNumber - 1).padStart(4, "0")}`
}

// ---------- Create and edit ----------

export async function createOrder(ctx: OrdersContext, input: OrderInput) {
  const v = parse(orderInputSchema, input)
  await checkReferences(ctx, v)
  const totals = totalsFor(v)
  return db.transaction(async (tx) => {
    const number = await nextNumber(tx, ctx.orgId)
    const [row] = await tx
      .insert(salesOrder)
      .values({
        orgId: ctx.orgId,
        number,
        customerId: v.customerId,
        orderDate: v.orderDate ?? today(),
        requestedOn: v.requestedOn,
        locationId: v.locationId,
        currency: v.currency,
        shippingAddress: v.shippingAddress,
        notes: v.notes,
        subtotalCents: totals.subtotalCents,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
        createdBy: ctx.user.id,
      })
      .returning()
    if (!row) throw new Error("insert failed")
    await tx
      .insert(salesOrderLine)
      .values(
        totals.lines.map((l, position) => ({ ...l, position, orgId: ctx.orgId, orderId: row.id })),
      )
    await event(
      tx,
      ctx,
      row.id,
      "created",
      `${ctx.user.name} created the order (${formatMoney(row.totalCents, row.currency)})`,
    )
    return row
  })
}

/** Drafts and confirmed orders can be edited until they're fulfilled. */
export async function updateOrder(ctx: OrdersContext, id: string, input: OrderInput) {
  const before = await ownOrder(ctx, id)
  if (!isEditable(before.status))
    throw conflict(`This order is ${before.status} and can't be edited.`)
  const v = parse(orderInputSchema, input)
  await checkReferences(ctx, v)
  const totals = totalsFor(v)
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(salesOrder)
      .set({
        customerId: v.customerId,
        orderDate: v.orderDate ?? before.orderDate,
        requestedOn: v.requestedOn,
        locationId: v.locationId,
        currency: v.currency,
        shippingAddress: v.shippingAddress,
        notes: v.notes,
        subtotalCents: totals.subtotalCents,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
      })
      .where(
        and(
          eq(salesOrder.id, id),
          eq(salesOrder.orgId, ctx.orgId),
          inArray(salesOrder.status, ["draft", "confirmed"]),
        ),
      )
      .returning()
    if (!row) throw conflict("This order can no longer be edited.")
    await tx.delete(salesOrderLine).where(eq(salesOrderLine.orderId, id))
    await tx
      .insert(salesOrderLine)
      .values(
        totals.lines.map((l, position) => ({ ...l, position, orgId: ctx.orgId, orderId: id })),
      )
    if (row.totalCents !== before.totalCents)
      await event(
        tx,
        ctx,
        id,
        "edited",
        `${ctx.user.name} changed the total from ${formatMoney(before.totalCents, before.currency)} to ${formatMoney(row.totalCents, row.currency)}`,
      )
    else await event(tx, ctx, id, "edited", `${ctx.user.name} edited the order`)
    return row
  })
}

export async function deleteDraftOrder(ctx: OrdersContext, id: string) {
  const o = await ownOrder(ctx, id)
  if (o.status !== "draft") throw conflict("Only drafts can be deleted. Cancel it instead.")
  await db.delete(salesOrder).where(and(eq(salesOrder.id, id), eq(salesOrder.orgId, ctx.orgId)))
}

/** A new draft with the same customer and lines, dated today. */
export async function duplicateOrder(ctx: OrdersContext, id: string) {
  const { order: o, lines } = await getOrder(ctx, id)
  return createOrder(ctx, {
    customerId: o.customerId,
    orderDate: today(),
    requestedOn: null,
    locationId: o.locationId,
    currency: o.currency as OrderInput["currency"],
    shippingAddress: o.shippingAddress,
    notes: o.notes,
    lines: lines.map((l) => ({
      productId: l.productStatus === "active" ? l.productId : null,
      description: l.description,
      quantity: String(l.quantityMilli / 1000),
      unitPrice: (l.unitPriceCents / 100).toFixed(2),
      taxRate: String(l.taxRateBp / 100),
    })),
  })
}

// ---------- Workflow ----------

async function lockOrder(tx: Tx, ctx: Pick<OrdersContext, "orgId">, id: string) {
  const [o] = await tx
    .select()
    .from(salesOrder)
    .where(and(eq(salesOrder.id, id), eq(salesOrder.orgId, ctx.orgId)))
    .for("update")
  if (!o) throw notFound()
  return o
}

export async function confirmOrder(ctx: OrdersContext, id: string) {
  await ownOrder(ctx, id)
  const o = await db.transaction(async (tx) => {
    const o = await lockOrder(tx, ctx, id)
    if (o.status !== "draft") throw conflict(`This order is already ${o.status}.`)
    const [row] = await tx
      .update(salesOrder)
      .set({ status: "confirmed", confirmedAt: new Date() })
      .where(eq(salesOrder.id, id))
      .returning()
    await event(tx, ctx, id, "confirmed", `${ctx.user.name} confirmed the order`)
    return row ?? o
  })
  const leads = await membersWithRole(ctx.orgId, ["owner", "admin"])
  await notify({
    orgId: ctx.orgId,
    to: leads.filter((u) => u !== ctx.user.id),
    type: "order.confirmed",
    title: `Order ${o.number} confirmed (${formatMoney(o.totalCents, o.currency)})`,
    link: `/orders/${id}`,
  })
  return o
}

/**
 * Ships the order: issues every product line from one location and marks it
 * fulfilled, in one transaction. If any product is short, nothing changes and
 * the error names each short line.
 */
export async function fulfillOrder(
  ctx: OrdersContext,
  id: string,
  opts: { locationId?: string | null } = {},
) {
  const pre = await ownOrder(ctx, id)
  const locationId = opts.locationId || pre.locationId
  const lines = await db
    .select()
    .from(salesOrderLine)
    .where(and(eq(salesOrderLine.orderId, id), eq(salesOrderLine.orgId, ctx.orgId)))
    .orderBy(asc(salesOrderLine.position))
  const stocked = lines.filter((l) => l.productId)
  if (stocked.length && !locationId) throw invalid({ locationId: "Choose where to ship from" })

  let low: Awaited<ReturnType<typeof issueMany>>["low"] = []
  const done = await db.transaction(async (tx) => {
    const o = await lockOrder(tx, ctx, id)
    if (o.status !== "confirmed")
      throw conflict(
        o.status === "draft" ? "Confirm the order first." : `This order is already ${o.status}.`,
      )
    let locName = ""
    if (stocked.length && locationId) {
      try {
        const r = await issueMany(
          ctx,
          {
            locationId,
            reason: "sold",
            reference: o.number,
            items: stocked.map((l) => ({
              productId: l.productId as string,
              quantityMilli: l.quantityMilli,
            })),
          },
          tx,
        )
        low = r.low
      } catch (e) {
        if (e instanceof InventoryError && e.fieldErrors) {
          // Point each shortage at the order line it came from.
          const mapped: Record<string, string> = {}
          for (const [k, msg] of Object.entries(e.fieldErrors)) {
            if (k.startsWith("product:")) {
              const pid = k.slice("product:".length)
              lines.forEach((l, i) => {
                if (l.productId === pid) mapped[`lines.${i}`] = msg
              })
            } else mapped[k] = msg
          }
          throw new OrderError("Not enough stock to fulfill this order.", 409, mapped)
        }
        throw e
      }
      const [l] = await tx
        .select({ name: location.name })
        .from(location)
        .where(eq(location.id, locationId))
      locName = l?.name ?? ""
    }
    const [row] = await tx
      .update(salesOrder)
      .set({ status: "fulfilled", fulfilledAt: new Date(), locationId: locationId ?? o.locationId })
      .where(eq(salesOrder.id, id))
      .returning()
    await event(
      tx,
      ctx,
      id,
      "fulfilled",
      stocked.length
        ? `${ctx.user.name} fulfilled the order: ${stocked.length} product ${stocked.length === 1 ? "line" : "lines"} shipped from ${locName}`
        : `${ctx.user.name} fulfilled the order`,
    )
    return row ?? o
  })
  await sendLowStockAlerts(ctx, low)
  return done
}

export async function cancelOrder(ctx: OrdersContext, id: string, reason: string) {
  await ownOrder(ctx, id)
  const r = reasonSchema.safeParse(reason)
  if (!r.success) throw invalid({ reason: r.error.issues[0]?.message ?? "Invalid" })
  const o = await db.transaction(async (tx) => {
    const o = await lockOrder(tx, ctx, id)
    if (!isEditable(o.status))
      throw conflict(
        o.status === "fulfilled"
          ? "Fulfilled orders can't be cancelled. Record a return instead."
          : "Already cancelled.",
      )
    const [row] = await tx
      .update(salesOrder)
      .set({ status: "cancelled", cancelledAt: new Date(), cancelReason: r.data })
      .where(eq(salesOrder.id, id))
      .returning()
    await event(tx, ctx, id, "cancelled", `${ctx.user.name} cancelled the order: ${r.data}`)
    return row ?? o
  })
  if (o.createdBy && o.createdBy !== ctx.user.id)
    await notify({
      orgId: ctx.orgId,
      to: [o.createdBy],
      type: "order.cancelled",
      title: `Order ${o.number} was cancelled`,
      body: `${ctx.user.name}: ${r.data}`,
      link: `/orders/${id}`,
    })
  return o
}

/** Makes a draft invoice from a confirmed or fulfilled order, once. */
export async function invoiceOrder(ctx: OrdersContext, id: string) {
  const { order: o, lines } = await getOrder(ctx, id)
  if (o.status !== "confirmed" && o.status !== "fulfilled")
    throw conflict("Confirm the order before invoicing it.")
  if (o.invoiceId) throw conflict("This order already has an invoice.")
  const settings = await getInvoiceSettings(ctx)
  const issue = today()
  const inv = await createInvoiceDraft(ctx, "invoice", {
    customerId: o.customerId,
    issueDate: issue,
    dueOn: addDays(issue, settings.defaultDueDays),
    currency: o.currency as never,
    notes: `Order ${o.number}`,
    lines: lines.map((l) => ({
      description: l.description,
      quantity: String(l.quantityMilli / 1000),
      unitPrice: (l.unitPriceCents / 100).toFixed(2),
      taxRate: String(l.taxRateBp / 100),
    })),
  })
  await db.transaction(async (tx) => {
    const locked = await lockOrder(tx, ctx, id)
    if (locked.invoiceId) throw conflict("This order already has an invoice.")
    await tx.update(salesOrder).set({ invoiceId: inv.id }).where(eq(salesOrder.id, id))
    await event(
      tx,
      ctx,
      id,
      "invoiced",
      `${ctx.user.name} created a draft invoice (${formatMoney(inv.totalCents, inv.currency)})`,
    )
  })
  return inv
}

export async function addOrderNote(ctx: OrdersContext, id: string, body: string) {
  await ownOrder(ctx, id)
  const r = noteSchema.safeParse(body)
  if (!r.success) throw invalid({ body: r.error.issues[0]?.message ?? "Invalid" })
  await event(db, ctx, id, "note", r.data)
}

// ---------- Reading ----------

export async function getOrder(ctx: Pick<OrdersContext, "orgId">, id: string) {
  const o = await ownOrder(ctx, id)
  const author = user
  const [cust, lines, events, inv, loc] = await Promise.all([
    db
      .select({
        id: customer.id,
        name: customer.name,
        email: customer.email,
        address: customer.address,
      })
      .from(customer)
      .where(eq(customer.id, o.customerId))
      .then((r) => r[0] ?? null),
    db
      .select({
        id: salesOrderLine.id,
        productId: salesOrderLine.productId,
        description: salesOrderLine.description,
        quantityMilli: salesOrderLine.quantityMilli,
        unitPriceCents: salesOrderLine.unitPriceCents,
        taxRateBp: salesOrderLine.taxRateBp,
        amountCents: salesOrderLine.amountCents,
        taxCents: salesOrderLine.taxCents,
        sku: product.sku,
        unit: product.unit,
        productStatus: product.status,
        /** On hand at the order's location (null without one). */
        available: o.locationId
          ? sql<
              number | null
            >`(select ${stockLevel.quantityMilli} from ${stockLevel} where ${stockLevel.productId} = ${salesOrderLine.productId} and ${stockLevel.locationId} = ${o.locationId})`.mapWith(
              (v) => (v === null ? 0 : Number(v)),
            )
          : sql<null>`null`,
      })
      .from(salesOrderLine)
      .leftJoin(product, eq(product.id, salesOrderLine.productId))
      .where(and(eq(salesOrderLine.orderId, o.id), eq(salesOrderLine.orgId, ctx.orgId)))
      .orderBy(asc(salesOrderLine.position)),
    db
      .select({
        id: salesOrderEvent.id,
        kind: salesOrderEvent.kind,
        body: salesOrderEvent.body,
        createdAt: salesOrderEvent.createdAt,
        byName: author.name,
      })
      .from(salesOrderEvent)
      .leftJoin(author, eq(author.id, salesOrderEvent.createdBy))
      .where(and(eq(salesOrderEvent.orderId, o.id), eq(salesOrderEvent.orgId, ctx.orgId)))
      .orderBy(desc(salesOrderEvent.createdAt))
      .limit(200),
    o.invoiceId
      ? db
          .select({
            id: invoice.id,
            number: invoice.number,
            kind: invoice.kind,
            status: invoice.status,
            dueOn: invoice.dueOn,
            totalCents: invoice.totalCents,
            amountPaidCents: invoice.amountPaidCents,
          })
          .from(invoice)
          .where(eq(invoice.id, o.invoiceId))
          .then((r) => r[0] ?? null)
      : null,
    o.locationId
      ? db
          .select({ id: location.id, name: location.name })
          .from(location)
          .where(eq(location.id, o.locationId))
          .then((r) => r[0] ?? null)
      : null,
  ])
  return { order: o, customer: cust, lines, events, invoice: inv, location: loc }
}

function filterWhere(ctx: Pick<OrdersContext, "orgId">, f: OrderFilter, todayStr: string) {
  const filter = orderFilterSchema.parse(f)
  const where: SQL[] = [eq(salesOrder.orgId, ctx.orgId)]
  if (filter.status) where.push(eq(salesOrder.status, filter.status))
  if (filter.due)
    where.push(eq(salesOrder.status, "confirmed"), lte(salesOrder.requestedOn, todayStr))
  if (filter.customer) where.push(eq(salesOrder.customerId, filter.customer))
  if (filter.q) {
    const t = likeTerm(filter.q)
    const s = or(ilike(salesOrder.number, t), ilike(customer.name, t))
    if (s) where.push(s)
  }
  return { where: and(...where), filter }
}

export async function listOrders(
  ctx: Pick<OrdersContext, "orgId">,
  f: OrderFilter = {},
  todayStr = today(),
) {
  const { where, filter } = filterWhere(ctx, f, todayStr)
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: salesOrder.id,
        number: salesOrder.number,
        status: salesOrder.status,
        orderDate: salesOrder.orderDate,
        requestedOn: salesOrder.requestedOn,
        currency: salesOrder.currency,
        totalCents: salesOrder.totalCents,
        invoiceId: salesOrder.invoiceId,
        invoiceNumber: invoice.number,
        invoicePaid: sql<boolean>`${invoice.amountPaidCents} >= ${invoice.totalCents} and ${invoice.status} = 'sent'`,
        customerId: salesOrder.customerId,
        customerName: customer.name,
      })
      .from(salesOrder)
      .innerJoin(customer, eq(customer.id, salesOrder.customerId))
      .leftJoin(invoice, eq(invoice.id, salesOrder.invoiceId))
      .where(where)
      .orderBy(desc(salesOrder.orderDate), desc(salesOrder.createdAt))
      .limit(PAGE_SIZE)
      .offset((filter.page - 1) * PAGE_SIZE),
    db
      .select({ n: count() })
      .from(salesOrder)
      .innerJoin(customer, eq(customer.id, salesOrder.customerId))
      .where(where),
  ])
  return { rows, total: total?.n ?? 0, page: filter.page, pageSize: PAGE_SIZE, filter }
}

/** Open orders and their value, orders due to ship, and fulfilled value in the last 30 days. */
export async function orderSummary(ctx: Pick<OrdersContext, "orgId">, todayStr = today()) {
  const value = sql<number>`coalesce(sum(${salesOrder.totalCents}), 0)::bigint`.mapWith(Number)
  const [open, due, fulfilled] = await Promise.all([
    db
      .select({ currency: salesOrder.currency, cents: value, n: count() })
      .from(salesOrder)
      .where(and(eq(salesOrder.orgId, ctx.orgId), eq(salesOrder.status, "confirmed")))
      .groupBy(salesOrder.currency),
    db
      .select({ n: count() })
      .from(salesOrder)
      .where(
        and(
          eq(salesOrder.orgId, ctx.orgId),
          eq(salesOrder.status, "confirmed"),
          isNotNull(salesOrder.requestedOn),
          lte(salesOrder.requestedOn, todayStr),
        ),
      ),
    db
      .select({ currency: salesOrder.currency, cents: value, n: count() })
      .from(salesOrder)
      .where(
        and(
          eq(salesOrder.orgId, ctx.orgId),
          eq(salesOrder.status, "fulfilled"),
          gte(salesOrder.fulfilledAt, new Date(`${addDays(todayStr, -30)}T00:00:00Z`)),
        ),
      )
      .groupBy(salesOrder.currency),
  ])
  return { open, due: due[0]?.n ?? 0, fulfilled }
}

/** Pickers for the order editor: customers, active products with stock, active locations. */
export async function orderOptions(ctx: Pick<OrdersContext, "orgId">) {
  const [customers, products, locations] = await Promise.all([
    db
      .select({ id: customer.id, name: customer.name, address: customer.address })
      .from(customer)
      .where(and(eq(customer.orgId, ctx.orgId), sql`${customer.status} <> 'inactive'`))
      .orderBy(asc(customer.name))
      .limit(2000),
    db
      .select({
        id: product.id,
        sku: product.sku,
        name: product.name,
        unit: product.unit,
        priceCents: product.priceCents,
        currency: product.currency,
      })
      .from(product)
      .where(and(eq(product.orgId, ctx.orgId), eq(product.status, "active")))
      .orderBy(asc(product.name))
      .limit(2000),
    db
      .select({ id: location.id, name: location.name })
      .from(location)
      .where(and(eq(location.orgId, ctx.orgId), eq(location.status, "active")))
      .orderBy(asc(location.name)),
  ])
  return { customers, products, locations }
}

export const statusLabel = (s: OrderStatus) => STATUS_LABELS[s]
export type { SalesOrder }
