import "server-only"

import { audit } from "@templates/audit"
import { db } from "@templates/db"
import {
  customer,
  location,
  organization,
  type PosRegister,
  type PosShift,
  posCashMovement,
  posPayment,
  posRefund,
  posRefundLine,
  posRegister,
  posSale,
  posSaleLine,
  posSettings,
  posShift,
  product,
  stockLevel,
  user,
} from "@templates/db/schema"
import { InventoryError, issueMany, restockMany, sendLowStockAlerts } from "@templates/inventory"
import { membersWithRole, notify } from "@templates/notifications"
import {
  type AnyColumn,
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { z } from "zod"

import {
  type CashMovementInput,
  type CheckoutInput,
  type CloseShiftInput,
  cashMovementSchema,
  checkoutSchema,
  closeShiftSchema,
  computeCart,
  fieldErrors,
  formatMoney,
  formatQuantity,
  type OpenShiftInput,
  openShiftSchema,
  parseMoney,
  type RefundInput,
  type RegisterInput,
  refundAmount,
  refundInputSchema,
  registerInputSchema,
  type SaleFilter,
  type SettingsInput,
  saleFilterSchema,
  settingsInputSchema,
  settlePayments,
  TENDERS,
  type Tender,
  today,
} from "./definitions"

export type PosContext = { orgId: string; user: { id: string; name: string; email: string } }

export class PosError extends Error {
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
type Org = Pick<PosContext, "orgId">

const isUuid = (s: string) => z.uuid().safeParse(s).success
const notFound = () => new PosError("Not found", 404)
const conflict = (m: string) => new PosError(m, 409)
const invalid = (fe: Record<string, string>, message = "Please fix the highlighted fields.") =>
  new PosError(message, 400, fe)

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input)
  if (!r.success) throw invalid(fieldErrors(r.error))
  return r.data
}

const pgCode = (e: unknown): string | undefined => {
  const err = e as { code?: string; cause?: unknown } | null
  return err?.code ?? (err?.cause ? pgCode(err.cause) : undefined)
}

const likeTerm = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
const sumCents = (col: AnyColumn) => sql<number>`coalesce(sum(${col}), 0)::bigint`.mapWith(Number)

// ---------- Settings ----------

export async function getPosSettings(ctx: Org) {
  await db.insert(posSettings).values({ orgId: ctx.orgId }).onConflictDoNothing()
  const [s] = await db.select().from(posSettings).where(eq(posSettings.orgId, ctx.orgId))
  if (!s) throw new Error("pos settings missing")
  return s
}

export async function updatePosSettings(ctx: PosContext, input: SettingsInput) {
  const v = parse(settingsInputSchema, input)
  await getPosSettings(ctx)
  const [row] = await db
    .update(posSettings)
    .set({
      receiptPrefix: v.receiptPrefix,
      currency: v.currency,
      taxRateBp: v.taxRate,
      pricesIncludeTax: v.pricesIncludeTax,
      maxDiscountBp: v.maxDiscount,
      timeZone: v.timeZone,
      receiptHeader: v.receiptHeader,
      receiptFooter: v.receiptFooter,
    })
    .where(eq(posSettings.orgId, ctx.orgId))
    .returning()
  await audit(ctx, "pos_settings.updated", "Updated point-of-sale settings", {
    metadata: {
      taxRateBp: v.taxRate,
      pricesIncludeTax: v.pricesIncludeTax,
      maxDiscountBp: v.maxDiscount,
    },
  })
  return row
}

// ---------- Registers ----------

async function ownRegister(ctx: Org, id: string, t: Tx | typeof db = db) {
  if (!isUuid(id)) throw notFound()
  const [r] = await t
    .select()
    .from(posRegister)
    .where(and(eq(posRegister.id, id), eq(posRegister.orgId, ctx.orgId)))
  if (!r) throw notFound()
  return r
}

async function checkLocation(ctx: Org, locationId: string) {
  const [l] = await db
    .select({ status: location.status })
    .from(location)
    .where(and(eq(location.id, locationId), eq(location.orgId, ctx.orgId)))
  if (!l) throw invalid({ locationId: "Choose a location from the list" })
  if (l.status !== "active") throw invalid({ locationId: "That location is archived" })
}

export async function saveRegister(ctx: PosContext, id: string | null, input: RegisterInput) {
  const v = parse(registerInputSchema, input)
  await checkLocation(ctx, v.locationId)
  try {
    if (id) {
      const before = await ownRegister(ctx, id)
      if (before.locationId !== v.locationId && (await openShiftFor(ctx, id)))
        throw invalid({ locationId: "Close the open shift before moving this register" })
      const [row] = await db
        .update(posRegister)
        .set({ name: v.name, locationId: v.locationId })
        .where(and(eq(posRegister.id, id), eq(posRegister.orgId, ctx.orgId)))
        .returning()
      await audit(ctx, "pos_register.updated", `Updated register ${v.name}`, {
        target: { type: "pos_register", id },
      })
      return row as PosRegister
    }
    const [row] = await db
      .insert(posRegister)
      .values({ orgId: ctx.orgId, name: v.name, locationId: v.locationId })
      .returning()
    if (!row) throw new Error("insert failed")
    await audit(ctx, "pos_register.created", `Added register ${v.name}`, {
      target: { type: "pos_register", id: row.id },
    })
    return row
  } catch (e) {
    if (pgCode(e) === "23505") throw invalid({ name: "You already have a register with this name" })
    throw e
  }
}

export async function setRegisterStatus(
  ctx: PosContext,
  id: string,
  status: "active" | "archived",
) {
  const r = await ownRegister(ctx, id)
  if (r.status === status) return
  if (status === "archived" && (await openShiftFor(ctx, id)))
    throw conflict("Close the open shift before archiving this register.")
  if (status === "active") await checkLocation(ctx, r.locationId)
  await db
    .update(posRegister)
    .set({ status })
    .where(and(eq(posRegister.id, id), eq(posRegister.orgId, ctx.orgId)))
  await audit(
    ctx,
    `pos_register.${status === "archived" ? "archived" : "restored"}`,
    `${status === "archived" ? "Archived" : "Restored"} register ${r.name}`,
    { target: { type: "pos_register", id } },
  )
}

const opener = alias(user, "opener")

/** Every register with its location and open shift, if any. */
export async function listRegisters(ctx: Org, opts: { includeArchived?: boolean } = {}) {
  const where = [eq(posRegister.orgId, ctx.orgId)]
  if (!opts.includeArchived) where.push(eq(posRegister.status, "active"))
  return db
    .select({
      id: posRegister.id,
      name: posRegister.name,
      status: posRegister.status,
      locationId: posRegister.locationId,
      locationName: location.name,
      shiftId: posShift.id,
      shiftOpenedAt: posShift.openedAt,
      shiftOpenedBy: opener.name,
    })
    .from(posRegister)
    .innerJoin(location, eq(location.id, posRegister.locationId))
    .leftJoin(posShift, and(eq(posShift.registerId, posRegister.id), eq(posShift.status, "open")))
    .leftJoin(opener, eq(opener.id, posShift.openedBy))
    .where(and(...where))
    .orderBy(asc(posRegister.status), asc(posRegister.name))
}

export async function getRegister(ctx: Org, id: string) {
  const r = await ownRegister(ctx, id)
  const [loc] = await db
    .select({ id: location.id, name: location.name })
    .from(location)
    .where(eq(location.id, r.locationId))
  const shift = await openShiftFor(ctx, id)
  const openedByName = shift?.openedBy
    ? ((await db.select({ name: user.name }).from(user).where(eq(user.id, shift.openedBy)))[0]
        ?.name ?? null)
    : null
  return { register: r, location: loc ?? null, shift, openedByName }
}

// ---------- Shifts and the cash drawer ----------

async function openShiftFor(ctx: Org, registerId: string, t: Tx | typeof db = db) {
  const [s] = await t
    .select()
    .from(posShift)
    .where(
      and(
        eq(posShift.orgId, ctx.orgId),
        eq(posShift.registerId, registerId),
        eq(posShift.status, "open"),
      ),
    )
  return s ?? null
}

async function ownShift(ctx: Org, id: string) {
  if (!isUuid(id)) throw notFound()
  const [s] = await db
    .select()
    .from(posShift)
    .where(and(eq(posShift.id, id), eq(posShift.orgId, ctx.orgId)))
  if (!s) throw notFound()
  return s
}

/** Locks a shift row so sales, refunds, cash movements and the close happen one at a time. */
async function lockShift(t: Tx, ctx: Org, where: SQL) {
  const [s] = await t
    .select()
    .from(posShift)
    .where(and(eq(posShift.orgId, ctx.orgId), where))
    .for("update")
  return s ?? null
}

/** Cash that should be in the drawer: float + cash sales + cash in − cash out − cash refunds. */
async function drawerBreakdown(
  t: Tx | typeof db,
  shift: Pick<PosShift, "id" | "openingFloatCents">,
) {
  const [[sales], movements, [refunds]] = await Promise.all([
    t
      .select({ cents: sumCents(posPayment.amountCents) })
      .from(posPayment)
      .innerJoin(posSale, eq(posSale.id, posPayment.saleId))
      .where(and(eq(posSale.shiftId, shift.id), eq(posPayment.tender, "cash"))),
    t
      .select({ kind: posCashMovement.kind, cents: sumCents(posCashMovement.amountCents) })
      .from(posCashMovement)
      .where(eq(posCashMovement.shiftId, shift.id))
      .groupBy(posCashMovement.kind),
    t
      .select({ cents: sumCents(posRefund.amountCents) })
      .from(posRefund)
      .where(and(eq(posRefund.shiftId, shift.id), eq(posRefund.tender, "cash"))),
  ])
  const paidIn = movements.find((m) => m.kind === "paid_in")?.cents ?? 0
  const paidOut = movements.find((m) => m.kind === "paid_out")?.cents ?? 0
  const cashSales = sales?.cents ?? 0
  const cashRefunds = refunds?.cents ?? 0
  return {
    openingFloatCents: shift.openingFloatCents,
    cashSalesCents: cashSales,
    paidInCents: paidIn,
    paidOutCents: paidOut,
    cashRefundsCents: cashRefunds,
    expectedCents: shift.openingFloatCents + cashSales + paidIn - paidOut - cashRefunds,
  }
}

export async function openShift(ctx: PosContext, registerId: string, input: OpenShiftInput) {
  const r = await ownRegister(ctx, registerId)
  if (r.status !== "active") throw conflict("This register is archived.")
  const v = parse(openShiftSchema, input)
  try {
    const [s] = await db
      .insert(posShift)
      .values({
        orgId: ctx.orgId,
        registerId,
        openingFloatCents: v.openingFloat,
        openedBy: ctx.user.id,
      })
      .returning()
    if (!s) throw new Error("insert failed")
    await audit(
      ctx,
      "pos_shift.opened",
      `Opened a shift on ${r.name} with ${formatMoney(v.openingFloat, (await getPosSettings(ctx)).currency)}`,
      { target: { type: "pos_shift", id: s.id } },
    )
    return s
  } catch (e) {
    if (pgCode(e) === "23505") throw conflict("A shift is already open on this register.")
    throw e
  }
}

export async function recordCashMovement(
  ctx: PosContext,
  shiftId: string,
  input: CashMovementInput,
) {
  await ownShift(ctx, shiftId)
  const v = parse(cashMovementSchema, input)
  const settings = await getPosSettings(ctx)
  return db.transaction(async (tx) => {
    const s = await lockShift(tx, ctx, eq(posShift.id, shiftId))
    if (!s) throw notFound()
    if (s.status !== "open") throw conflict("This shift is closed.")
    if (v.kind === "paid_out") {
      const d = await drawerBreakdown(tx, s)
      if (v.amount > d.expectedCents)
        throw invalid({
          amount: `Only ${formatMoney(d.expectedCents, settings.currency)} should be in the drawer`,
        })
    }
    const [m] = await tx
      .insert(posCashMovement)
      .values({
        orgId: ctx.orgId,
        shiftId,
        kind: v.kind,
        amountCents: v.amount,
        reason: v.reason,
        createdBy: ctx.user.id,
      })
      .returning()
    await audit(
      ctx,
      `pos_cash.${v.kind}`,
      `${v.kind === "paid_in" ? "Put" : "Took"} ${formatMoney(v.amount, settings.currency)} ${v.kind === "paid_in" ? "into" : "out of"} the drawer: ${v.reason}`,
      { target: { type: "pos_shift", id: shiftId } },
    )
    return m
  })
}

/** Counts the drawer and closes the shift. Owners and admins hear about any difference. */
export async function closeShift(ctx: PosContext, shiftId: string, input: CloseShiftInput) {
  await ownShift(ctx, shiftId)
  const v = parse(closeShiftSchema, input)
  const settings = await getPosSettings(ctx)
  const closed = await db.transaction(async (tx) => {
    const s = await lockShift(tx, ctx, eq(posShift.id, shiftId))
    if (!s) throw notFound()
    if (s.status !== "open") throw conflict("This shift is already closed.")
    const d = await drawerBreakdown(tx, s)
    const [row] = await tx
      .update(posShift)
      .set({
        status: "closed",
        expectedCashCents: d.expectedCents,
        countedCashCents: v.countedCash,
        varianceCents: v.countedCash - d.expectedCents,
        closingNote: v.note,
        closedBy: ctx.user.id,
        closedAt: new Date(),
      })
      .where(eq(posShift.id, shiftId))
      .returning()
    if (!row) throw new Error("update failed")
    return row
  })
  const [reg] = await db
    .select({ name: posRegister.name })
    .from(posRegister)
    .where(eq(posRegister.id, closed.registerId))
  const variance = closed.varianceCents ?? 0
  const diff =
    variance === 0
      ? "drawer matched"
      : `${formatMoney(Math.abs(variance), settings.currency)} ${variance < 0 ? "short" : "over"}`
  await audit(
    ctx,
    "pos_shift.closed",
    `Closed the shift on ${reg?.name ?? "a register"}: ${diff}`,
    {
      target: { type: "pos_shift", id: shiftId },
      metadata: {
        expectedCents: closed.expectedCashCents,
        countedCents: closed.countedCashCents,
        varianceCents: variance,
      },
    },
  )
  if (variance !== 0) {
    const leads = await membersWithRole(ctx.orgId, ["owner", "admin"])
    await notify({
      orgId: ctx.orgId,
      to: leads.filter((u) => u !== ctx.user.id),
      type: "pos.cash_variance",
      title: `${reg?.name ?? "Register"} closed ${diff}`,
      body: `${ctx.user.name} counted ${formatMoney(closed.countedCashCents ?? 0, settings.currency)}; ${formatMoney(closed.expectedCashCents ?? 0, settings.currency)} was expected.${v.note ? ` Note: ${v.note}` : ""}`,
      link: `/pos/shifts/${shiftId}`,
    })
  }
  return closed
}

const closer = alias(user, "closer")

export async function listShifts(ctx: Org, f: { register?: string; page?: number } = {}) {
  const page = Math.max(1, Math.min(10_000, Math.trunc(Number(f.page) || 1)))
  const where = [eq(posShift.orgId, ctx.orgId)]
  if (f.register && isUuid(f.register)) where.push(eq(posShift.registerId, f.register))
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: posShift.id,
        status: posShift.status,
        openedAt: posShift.openedAt,
        closedAt: posShift.closedAt,
        registerName: posRegister.name,
        openedBy: opener.name,
        closedBy: closer.name,
        expectedCashCents: posShift.expectedCashCents,
        countedCashCents: posShift.countedCashCents,
        varianceCents: posShift.varianceCents,
        sales:
          sql<number>`(select count(*) from ${posSale} where ${posSale.shiftId} = ${posShift.id})`.mapWith(
            Number,
          ),
        salesCents:
          sql<number>`(select coalesce(sum(${posSale.totalCents}), 0) from ${posSale} where ${posSale.shiftId} = ${posShift.id})`.mapWith(
            Number,
          ),
      })
      .from(posShift)
      .innerJoin(posRegister, eq(posRegister.id, posShift.registerId))
      .leftJoin(opener, eq(opener.id, posShift.openedBy))
      .leftJoin(closer, eq(closer.id, posShift.closedBy))
      .where(and(...where))
      .orderBy(desc(posShift.openedAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db
      .select({ n: count() })
      .from(posShift)
      .where(and(...where)),
  ])
  return { rows, total: total?.n ?? 0, page, pageSize: PAGE_SIZE }
}

/** The end-of-shift report: takings by tender, refunds, cash movements and the drawer count. */
export async function shiftReport(ctx: Org, shiftId: string) {
  const s = await ownShift(ctx, shiftId)
  const [reg, people, totals, byTender, refunds, movements, drawer, settings] = await Promise.all([
    db
      .select({ id: posRegister.id, name: posRegister.name, locationName: location.name })
      .from(posRegister)
      .innerJoin(location, eq(location.id, posRegister.locationId))
      .where(eq(posRegister.id, s.registerId))
      .then((r) => r[0] ?? null),
    db
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(
        inArray(
          user.id,
          [s.openedBy, s.closedBy].filter((x): x is string => !!x),
        ),
      ),
    db
      .select({
        sales: count(),
        subtotalCents: sumCents(posSale.subtotalCents),
        discountCents: sumCents(posSale.discountCents),
        taxCents: sumCents(posSale.taxCents),
        totalCents: sumCents(posSale.totalCents),
      })
      .from(posSale)
      .where(eq(posSale.shiftId, s.id))
      .then((r) => r[0]),
    db
      .select({ tender: posPayment.tender, cents: sumCents(posPayment.amountCents), n: count() })
      .from(posPayment)
      .innerJoin(posSale, eq(posSale.id, posPayment.saleId))
      .where(eq(posSale.shiftId, s.id))
      .groupBy(posPayment.tender),
    db
      .select({ tender: posRefund.tender, cents: sumCents(posRefund.amountCents), n: count() })
      .from(posRefund)
      .where(eq(posRefund.shiftId, s.id))
      .groupBy(posRefund.tender),
    db
      .select({
        id: posCashMovement.id,
        kind: posCashMovement.kind,
        amountCents: posCashMovement.amountCents,
        reason: posCashMovement.reason,
        createdAt: posCashMovement.createdAt,
        byName: user.name,
      })
      .from(posCashMovement)
      .leftJoin(user, eq(user.id, posCashMovement.createdBy))
      .where(eq(posCashMovement.shiftId, s.id))
      .orderBy(asc(posCashMovement.createdAt)),
    drawerBreakdown(db, s),
    getPosSettings(ctx),
  ])
  const name = (id: string | null) => people.find((p) => p.id === id)?.name ?? null
  const tenders = TENDERS.map((t) => ({
    tender: t,
    salesCents: byTender.find((b) => b.tender === t)?.cents ?? 0,
    refundsCents: refunds.find((b) => b.tender === t)?.cents ?? 0,
  }))
  return {
    shift: s,
    register: reg,
    openedByName: name(s.openedBy),
    closedByName: name(s.closedBy),
    totals: {
      sales: totals?.sales ?? 0,
      subtotalCents: totals?.subtotalCents ?? 0,
      discountCents: totals?.discountCents ?? 0,
      taxCents: totals?.taxCents ?? 0,
      totalCents: totals?.totalCents ?? 0,
      refundsCents: tenders.reduce((n, t) => n + t.refundsCents, 0),
    },
    tenders,
    movements,
    drawer,
    currency: settings.currency,
    pricesIncludeTax: settings.pricesIncludeTax,
  }
}

// ---------- Selling ----------

async function nextReceiptNumber(tx: Tx, orgId: string) {
  await tx.insert(posSettings).values({ orgId }).onConflictDoNothing()
  const [s] = await tx
    .update(posSettings)
    .set({ nextNumber: sql`${posSettings.nextNumber} + 1` })
    .where(eq(posSettings.orgId, orgId))
    .returning()
  if (!s) throw new Error("pos settings missing")
  return `${s.receiptPrefix}${String(s.nextNumber - 1).padStart(5, "0")}`
}

export type CheckoutOptions = {
  /** People with `pos: manage` can give any discount; others stop at the settings limit. */
  canOverrideDiscount?: boolean
}

/**
 * Rings up a sale: prices come from the catalog (never the till), stock leaves
 * the register's location, payments are settled with change, and everything is
 * saved in one transaction. Sending the same `clientKey` again returns the
 * first sale instead of charging twice.
 */
export async function checkout(ctx: PosContext, input: CheckoutInput, opts: CheckoutOptions = {}) {
  const v = parse(checkoutSchema, input)
  const [settings, register] = await Promise.all([
    getPosSettings(ctx),
    ownRegister(ctx, v.registerId),
  ])

  // A retry of a sale that already went through: hand back the original.
  const replay = await saleByKey(ctx, v.clientKey)
  if (replay) {
    if (replay.registerId !== v.registerId) throw conflict("This sale key was already used.")
    return { sale: replay, replay: true as const, changeCents: await changeGiven(replay.id) }
  }
  if (register.status !== "active") throw conflict("This register is archived.")

  const errors: Record<string, string> = {}
  if (v.customerId) {
    const [c] = await db
      .select({ id: customer.id })
      .from(customer)
      .where(and(eq(customer.id, v.customerId), eq(customer.orgId, ctx.orgId)))
    if (!c) errors.customerId = "Choose a customer from the list"
  }
  const ids = [...new Set(v.lines.map((l) => l.productId).filter((x): x is string => !!x))]
  const products = new Map(
    (ids.length
      ? await db
          .select({
            id: product.id,
            name: product.name,
            sku: product.sku,
            priceCents: product.priceCents,
            currency: product.currency,
            status: product.status,
          })
          .from(product)
          .where(and(eq(product.orgId, ctx.orgId), inArray(product.id, ids)))
      : []
    ).map((p) => [p.id, p]),
  )
  const priced = v.lines.map((l, i) => {
    if (l.discount > settings.maxDiscountBp && !opts.canOverrideDiscount)
      errors[`lines.${i}.discount`] = `Up to ${settings.maxDiscountBp / 100}% without a manager`
    if (l.productId) {
      const p = products.get(l.productId)
      if (!p) errors[`lines.${i}.productId`] = "Choose a product from the list"
      else if (p.status !== "active") errors[`lines.${i}.productId`] = `${p.name} is archived`
      else if (p.currency !== settings.currency)
        errors[`lines.${i}.productId`] =
          `${p.name} is priced in ${p.currency}, not ${settings.currency}`
      return {
        productId: l.productId,
        description: p?.name ?? "",
        quantityMilli: l.quantity,
        unitPriceCents: p?.priceCents ?? 0,
        discountBp: l.discount,
      }
    }
    return {
      productId: null,
      description: l.description ?? "",
      quantityMilli: l.quantity,
      unitPriceCents: parseMoney(String(l.unitPrice ?? "")) ?? 0,
      discountBp: l.discount,
    }
  })
  if (Object.keys(errors).length) throw invalid(errors)

  const cart = computeCart(priced, settings)
  const settled = settlePayments(
    cart.totalCents,
    v.payments.map((p) => ({ tender: p.tender, tenderedCents: p.amount, reference: p.reference })),
  )
  if (!settled.ok)
    throw invalid({
      payments:
        settled.error === "still_due"
          ? `${formatMoney(settled.dueCents ?? 0, settings.currency)} still to pay`
          : settled.error,
    })

  let low: Awaited<ReturnType<typeof issueMany>>["low"] = []
  const result = await db.transaction(async (tx) => {
    // The shift lock puts this register's sales in a line and keeps the close from slipping in between.
    const shift = await lockShift(
      tx,
      ctx,
      and(eq(posShift.registerId, v.registerId), eq(posShift.status, "open")) as SQL,
    )
    if (!shift) throw conflict("Open a shift on this register first.")
    const again = await saleByKey(ctx, v.clientKey, tx)
    if (again) return { sale: again, replay: true as const }

    const number = await nextReceiptNumber(tx, ctx.orgId)
    const [sale] = await tx
      .insert(posSale)
      .values({
        orgId: ctx.orgId,
        number,
        clientKey: v.clientKey,
        shiftId: shift.id,
        registerId: v.registerId,
        customerId: v.customerId,
        currency: settings.currency,
        subtotalCents: cart.subtotalCents,
        discountCents: cart.discountCents,
        taxCents: cart.taxCents,
        totalCents: cart.totalCents,
        note: v.note,
        cashierId: ctx.user.id,
      })
      .returning()
    if (!sale) throw new Error("insert failed")

    const stocked = cart.lines.filter((l) => l.productId)
    if (stocked.length) {
      try {
        const r = await issueMany(
          ctx,
          {
            locationId: register.locationId,
            reason: "sold",
            reference: number,
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
          const mapped: Record<string, string> = {}
          for (const [k, msg] of Object.entries(e.fieldErrors)) {
            if (!k.startsWith("product:")) {
              mapped[k] = msg
              continue
            }
            const pid = k.slice("product:".length)
            cart.lines.forEach((l, i) => {
              if (l.productId === pid) mapped[`lines.${i}.quantity`] = msg
            })
          }
          throw new PosError("Not enough stock for this sale.", 409, mapped)
        }
        throw e
      }
    }

    await tx.insert(posSaleLine).values(
      cart.lines.map((l, position) => ({
        orgId: ctx.orgId,
        saleId: sale.id,
        position,
        productId: l.productId,
        description: l.description,
        quantityMilli: l.quantityMilli,
        unitPriceCents: l.unitPriceCents,
        discountBp: l.discountBp,
        discountCents: l.discountCents,
        taxRateBp: l.taxRateBp,
        taxCents: l.taxCents,
        totalCents: l.totalCents,
      })),
    )
    if (settled.payments.length)
      await tx.insert(posPayment).values(
        settled.payments.map((p) => ({
          orgId: ctx.orgId,
          saleId: sale.id,
          tender: p.tender,
          amountCents: p.amountCents,
          tenderedCents: p.tenderedCents,
          changeCents: p.changeCents,
          reference: p.reference ?? null,
        })),
      )
    return { sale, replay: false as const }
  })
  if (!result.replay) await sendLowStockAlerts(ctx, low)
  return {
    ...result,
    changeCents: result.replay ? await changeGiven(result.sale.id) : settled.changeCents,
  }
}

async function changeGiven(saleId: string) {
  const [r] = await db
    .select({ cents: sumCents(posPayment.changeCents) })
    .from(posPayment)
    .where(eq(posPayment.saleId, saleId))
  return r?.cents ?? 0
}

async function saleByKey(ctx: Org, key: string, t: Tx | typeof db = db) {
  const [s] = await t
    .select()
    .from(posSale)
    .where(and(eq(posSale.orgId, ctx.orgId), eq(posSale.clientKey, key)))
  return s ?? null
}

// ---------- Refunds ----------

/**
 * Gives money back for some or all of a sale, from a register with an open
 * shift. Never more than was sold; cash refunds can't take more than the
 * drawer holds. Restocking puts the items back at that register's location.
 */
export async function refundSale(ctx: PosContext, saleId: string, input: RefundInput) {
  const pre = await ownSale(ctx, saleId)
  const v = parse(refundInputSchema, input)
  const register = await ownRegister(ctx, v.registerId)
  const settings = await getPosSettings(ctx)
  const refund = await db.transaction(async (tx) => {
    const shift = await lockShift(
      tx,
      ctx,
      and(eq(posShift.registerId, register.id), eq(posShift.status, "open")) as SQL,
    )
    if (!shift) throw invalid({ registerId: "Open a shift on this register first" })
    // Lock the sale so two refunds can't both give back the same items.
    const [sale] = await tx
      .select()
      .from(posSale)
      .where(and(eq(posSale.id, saleId), eq(posSale.orgId, ctx.orgId)))
      .for("update")
    if (!sale) throw notFound()
    const lines = await tx
      .select()
      .from(posSaleLine)
      .where(and(eq(posSaleLine.saleId, saleId), eq(posSaleLine.orgId, ctx.orgId)))
      .orderBy(asc(posSaleLine.position))
    const byId = new Map(lines.map((l) => [l.id, l]))
    const want = new Map<string, number>()
    const errors: Record<string, string> = {}
    v.lines.forEach((r, i) => {
      const l = byId.get(r.lineId)
      if (!l) {
        errors[`lines.${i}.quantity`] = "That item isn't on this sale"
        return
      }
      const total = (want.get(l.id) ?? 0) + r.quantity
      const left = l.quantityMilli - l.refundedQtyMilli
      if (total > left)
        errors[`lines.${i}.quantity`] =
          left === 0 ? "Already refunded" : `Only ${formatQuantity(left)} left to refund`
      want.set(l.id, total)
    })
    if (Object.keys(errors).length) throw invalid(errors)

    const items = [...want].map(([id, qty]) => {
      const l = byId.get(id) as (typeof lines)[number]
      return { line: l, quantityMilli: qty, amountCents: refundAmount(l, qty) }
    })
    const amount = items.reduce((s, i) => s + i.amountCents, 0)

    if (v.tender === "cash") {
      const d = await drawerBreakdown(tx, shift)
      if (amount > d.expectedCents)
        throw invalid({
          tender: `Only ${formatMoney(d.expectedCents, settings.currency)} should be in the drawer`,
        })
    }

    const [row] = await tx
      .insert(posRefund)
      .values({
        orgId: ctx.orgId,
        saleId,
        shiftId: shift.id,
        tender: v.tender,
        amountCents: amount,
        reason: v.reason,
        restocked: v.restock && items.some((i) => i.line.productId),
        createdBy: ctx.user.id,
      })
      .returning()
    if (!row) throw new Error("insert failed")
    await tx.insert(posRefundLine).values(
      items.map((i) => ({
        orgId: ctx.orgId,
        refundId: row.id,
        saleLineId: i.line.id,
        quantityMilli: i.quantityMilli,
        amountCents: i.amountCents,
      })),
    )
    for (const i of items)
      await tx
        .update(posSaleLine)
        .set({
          refundedQtyMilli: sql`${posSaleLine.refundedQtyMilli} + ${i.quantityMilli}`,
          refundedCents: sql`${posSaleLine.refundedCents} + ${i.amountCents}`,
        })
        .where(eq(posSaleLine.id, i.line.id))
    await tx
      .update(posSale)
      .set({ refundedCents: sql`${posSale.refundedCents} + ${amount}` })
      .where(eq(posSale.id, saleId))

    const back = items.filter((i) => i.line.productId)
    if (v.restock && back.length)
      await restockMany(
        ctx,
        {
          locationId: register.locationId,
          reference: sale.number,
          note: `Refund: ${v.reason}`,
          items: back.map((i) => ({
            productId: i.line.productId as string,
            quantityMilli: i.quantityMilli,
          })),
        },
        tx,
      )
    return row
  })
  await audit(
    ctx,
    "pos_sale.refunded",
    `Refunded ${formatMoney(refund.amountCents, settings.currency)} (${refund.tender}) on sale ${pre.number}: ${v.reason}`,
    {
      target: { type: "pos_sale", id: saleId },
      metadata: { refundId: refund.id, restocked: refund.restocked },
    },
  )
  return refund
}

// ---------- Reading ----------

async function ownSale(ctx: Org, id: string) {
  if (!isUuid(id)) throw notFound()
  const [s] = await db
    .select()
    .from(posSale)
    .where(and(eq(posSale.id, id), eq(posSale.orgId, ctx.orgId)))
  if (!s) throw notFound()
  return s
}

/** A sale with everything a receipt or refund screen needs. */
export async function getSale(ctx: Org, id: string) {
  const s = await ownSale(ctx, id)
  const [lines, payments, refunds, refundLines, reg, cashier, cust, settings, org] =
    await Promise.all([
      db
        .select({
          id: posSaleLine.id,
          productId: posSaleLine.productId,
          description: posSaleLine.description,
          sku: product.sku,
          unit: product.unit,
          quantityMilli: posSaleLine.quantityMilli,
          unitPriceCents: posSaleLine.unitPriceCents,
          discountBp: posSaleLine.discountBp,
          discountCents: posSaleLine.discountCents,
          taxRateBp: posSaleLine.taxRateBp,
          taxCents: posSaleLine.taxCents,
          totalCents: posSaleLine.totalCents,
          refundedQtyMilli: posSaleLine.refundedQtyMilli,
          refundedCents: posSaleLine.refundedCents,
        })
        .from(posSaleLine)
        .leftJoin(product, eq(product.id, posSaleLine.productId))
        .where(and(eq(posSaleLine.saleId, s.id), eq(posSaleLine.orgId, ctx.orgId)))
        .orderBy(asc(posSaleLine.position)),
      db
        .select()
        .from(posPayment)
        .where(and(eq(posPayment.saleId, s.id), eq(posPayment.orgId, ctx.orgId))),
      db
        .select({
          id: posRefund.id,
          tender: posRefund.tender,
          amountCents: posRefund.amountCents,
          reason: posRefund.reason,
          restocked: posRefund.restocked,
          createdAt: posRefund.createdAt,
          byName: user.name,
        })
        .from(posRefund)
        .leftJoin(user, eq(user.id, posRefund.createdBy))
        .where(and(eq(posRefund.saleId, s.id), eq(posRefund.orgId, ctx.orgId)))
        .orderBy(asc(posRefund.createdAt)),
      db
        .select({
          refundId: posRefundLine.refundId,
          saleLineId: posRefundLine.saleLineId,
          quantityMilli: posRefundLine.quantityMilli,
          amountCents: posRefundLine.amountCents,
        })
        .from(posRefundLine)
        .innerJoin(posRefund, eq(posRefund.id, posRefundLine.refundId))
        .where(and(eq(posRefund.saleId, s.id), eq(posRefundLine.orgId, ctx.orgId))),
      db
        .select({ id: posRegister.id, name: posRegister.name })
        .from(posRegister)
        .where(eq(posRegister.id, s.registerId))
        .then((r) => r[0] ?? null),
      s.cashierId
        ? db
            .select({ name: user.name })
            .from(user)
            .where(eq(user.id, s.cashierId))
            .then((r) => r[0]?.name ?? null)
        : null,
      s.customerId
        ? db
            .select({ id: customer.id, name: customer.name })
            .from(customer)
            .where(eq(customer.id, s.customerId))
            .then((r) => r[0] ?? null)
        : null,
      getPosSettings(ctx),
      db
        .select({ name: organization.name })
        .from(organization)
        .where(eq(organization.id, ctx.orgId))
        .then((r) => r[0]?.name ?? ""),
    ])
  return {
    sale: s,
    orgName: org,
    lines,
    payments,
    refunds: refunds.map((r) => ({ ...r, lines: refundLines.filter((l) => l.refundId === r.id) })),
    register: reg,
    cashierName: cashier,
    customer: cust,
    settings,
    refundedAll: lines.every((l) => l.refundedQtyMilli >= l.quantityMilli),
  }
}

/** Start and end of a calendar day in the business's time zone, as SQL timestamps. */
function dayRange(day: string, timeZone: string) {
  return {
    start: sql`((${day})::date)::timestamp at time zone ${timeZone}`,
    end: sql`((${day})::date + 1)::timestamp at time zone ${timeZone}`,
  }
}

export async function listSales(ctx: Org, f: SaleFilter = {}) {
  const filter = saleFilterSchema.parse(f)
  const settings = await getPosSettings(ctx)
  const where: SQL[] = [eq(posSale.orgId, ctx.orgId)]
  if (filter.register) where.push(eq(posSale.registerId, filter.register))
  if (filter.day) {
    const r = dayRange(filter.day, settings.timeZone)
    where.push(sql`${posSale.createdAt} >= ${r.start}`, sql`${posSale.createdAt} < ${r.end}`)
  }
  if (filter.q) {
    const t = likeTerm(filter.q)
    const s = or(ilike(posSale.number, t), ilike(customer.name, t))
    if (s) where.push(s)
  }
  const cond = and(...where)
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: posSale.id,
        number: posSale.number,
        createdAt: posSale.createdAt,
        totalCents: posSale.totalCents,
        refundedCents: posSale.refundedCents,
        currency: posSale.currency,
        registerName: posRegister.name,
        cashierName: user.name,
        customerName: customer.name,
        items:
          sql<number>`(select coalesce(sum(${posSaleLine.quantityMilli}), 0) from ${posSaleLine} where ${posSaleLine.saleId} = ${posSale.id})`.mapWith(
            Number,
          ),
        tenders: sql<string>`(select string_agg(distinct ${posPayment.tender}, ',') from ${posPayment} where ${posPayment.saleId} = ${posSale.id})`,
      })
      .from(posSale)
      .innerJoin(posRegister, eq(posRegister.id, posSale.registerId))
      .leftJoin(user, eq(user.id, posSale.cashierId))
      .leftJoin(customer, eq(customer.id, posSale.customerId))
      .where(cond)
      .orderBy(desc(posSale.createdAt))
      .limit(PAGE_SIZE)
      .offset((filter.page - 1) * PAGE_SIZE),
    db
      .select({ n: count() })
      .from(posSale)
      .leftJoin(customer, eq(customer.id, posSale.customerId))
      .where(cond),
  ])
  return { rows, total: total?.n ?? 0, page: filter.page, pageSize: PAGE_SIZE, filter }
}

/** One day's takings in the business's time zone: totals, tenders, busiest hours, best sellers. */
export async function salesSummary(ctx: Org, day?: string) {
  const settings = await getPosSettings(ctx)
  const d = day ?? today(settings.timeZone)
  const r = dayRange(d, settings.timeZone)
  const inDay = and(
    eq(posSale.orgId, ctx.orgId),
    sql`${posSale.createdAt} >= ${r.start}`,
    sql`${posSale.createdAt} < ${r.end}`,
  )
  const [totals, tenders, refunds, hours, top] = await Promise.all([
    db
      .select({
        sales: count(),
        totalCents: sumCents(posSale.totalCents),
        discountCents: sumCents(posSale.discountCents),
        taxCents: sumCents(posSale.taxCents),
      })
      .from(posSale)
      .where(inDay)
      .then((x) => x[0]),
    db
      .select({ tender: posPayment.tender, cents: sumCents(posPayment.amountCents) })
      .from(posPayment)
      .innerJoin(posSale, eq(posSale.id, posPayment.saleId))
      .where(inDay)
      .groupBy(posPayment.tender),
    db
      .select({ cents: sumCents(posRefund.amountCents), n: count() })
      .from(posRefund)
      .where(
        and(
          eq(posRefund.orgId, ctx.orgId),
          sql`${posRefund.createdAt} >= ${r.start}`,
          sql`${posRefund.createdAt} < ${r.end}`,
        ),
      )
      .then((x) => x[0]),
    db
      .select({
        hour: sql<number>`extract(hour from ${posSale.createdAt} at time zone ${settings.timeZone})::int`.mapWith(
          Number,
        ),
        sales: count(),
        cents: sumCents(posSale.totalCents),
      })
      .from(posSale)
      .where(inDay)
      .groupBy(sql`1`)
      .orderBy(sql`1`),
    db
      .select({
        description: posSaleLine.description,
        productId: posSaleLine.productId,
        quantityMilli:
          sql<number>`sum(${posSaleLine.quantityMilli} - ${posSaleLine.refundedQtyMilli})::bigint`.mapWith(
            Number,
          ),
        cents:
          sql<number>`sum(${posSaleLine.totalCents} - ${posSaleLine.refundedCents})::bigint`.mapWith(
            Number,
          ),
      })
      .from(posSaleLine)
      .innerJoin(posSale, eq(posSale.id, posSaleLine.saleId))
      .where(inDay)
      .groupBy(posSaleLine.productId, posSaleLine.description)
      .orderBy(desc(sql`4`))
      .limit(5),
  ])
  const sales = totals?.sales ?? 0
  const gross = totals?.totalCents ?? 0
  return {
    day: d,
    currency: settings.currency,
    timeZone: settings.timeZone,
    sales,
    grossCents: gross,
    refundsCents: refunds?.cents ?? 0,
    netCents: gross - (refunds?.cents ?? 0),
    averageCents: sales ? Math.round(gross / sales) : 0,
    discountCents: totals?.discountCents ?? 0,
    taxCents: totals?.taxCents ?? 0,
    tenders: TENDERS.map((t) => ({
      tender: t,
      cents: tenders.find((x) => x.tender === t)?.cents ?? 0,
    })),
    hours,
    top,
  }
}

/** What the till needs: active products with on-hand at the register's location, and customers. */
export async function tillCatalog(ctx: Org, registerId: string) {
  const r = await ownRegister(ctx, registerId)
  const settings = await getPosSettings(ctx)
  const [products, customers] = await Promise.all([
    db
      .select({
        id: product.id,
        sku: product.sku,
        barcode: product.barcode,
        name: product.name,
        category: product.category,
        unit: product.unit,
        priceCents: product.priceCents,
        onHandMilli: sql<number>`coalesce(${stockLevel.quantityMilli}, 0)`.mapWith(Number),
      })
      .from(product)
      .leftJoin(
        stockLevel,
        and(eq(stockLevel.productId, product.id), eq(stockLevel.locationId, r.locationId)),
      )
      .where(
        and(
          eq(product.orgId, ctx.orgId),
          eq(product.status, "active"),
          eq(product.currency, settings.currency),
        ),
      )
      .orderBy(asc(product.name))
      .limit(5000),
    db
      .select({ id: customer.id, name: customer.name })
      .from(customer)
      .where(and(eq(customer.orgId, ctx.orgId), sql`${customer.status} <> 'inactive'`))
      .orderBy(asc(customer.name))
      .limit(2000),
  ])
  return { products, customers, settings }
}

/** Active registers for pickers, e.g. which till gives a refund. */
export async function registerOptions(ctx: Org) {
  return db
    .select({ id: posRegister.id, name: posRegister.name })
    .from(posRegister)
    .where(and(eq(posRegister.orgId, ctx.orgId), eq(posRegister.status, "active")))
    .orderBy(asc(posRegister.name))
}

export type { PosRegister, PosShift, Tender }
