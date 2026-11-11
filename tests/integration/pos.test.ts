import { randomUUID } from "node:crypto"

import { createCustomer } from "@templates/crm"
import { db } from "@templates/db"
import { organization, posPayment, posSale, posSaleLine, posShift } from "@templates/db/schema"
import {
  createLocation,
  createProduct,
  getProduct,
  receiveStock,
  setProductStatus,
} from "@templates/inventory"
import { listNotifications } from "@templates/notifications"
import {
  type CheckoutInput,
  checkout,
  closeShift,
  computeCart,
  computeLine,
  getSale,
  listSales,
  openShift,
  recordCashMovement,
  refundAmount,
  refundSale,
  salesSummary,
  saveRegister,
  settlePayments,
  shiftReport,
  updatePosSettings,
} from "@templates/pos"
import { eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { addMember, newOrgOwner } from "../setup/client"

type Person = { id: string; name: string; email: string }
const ctxOf = (orgId: string, u: Person) => ({
  orgId,
  user: { id: u.id, name: u.name, email: u.email },
})

async function setup(opts: { taxRate?: string; inclusive?: boolean } = {}) {
  const org = await newOrgOwner("Acme")
  const ctx = ctxOf(org.orgId, org)
  await updatePosSettings(ctx, {
    receiptPrefix: "R-",
    currency: "USD",
    taxRate: opts.taxRate ?? "12",
    pricesIncludeTax: opts.inclusive ?? true,
    maxDiscount: "10",
    timeZone: "Asia/Manila",
  })
  const [shop, back, latte, beans] = await Promise.all([
    createLocation(ctx, { name: "Shop floor" }),
    createLocation(ctx, { name: "Back room" }),
    createProduct(ctx, { sku: "LAT", name: "Latte", unit: "pcs", currency: "USD", price: "4.50" }),
    createProduct(ctx, {
      sku: "BEAN",
      name: "Beans 250g",
      unit: "pcs",
      currency: "USD",
      price: "12",
    }),
  ])
  await receiveStock(ctx, latte.id, { locationId: shop.id, quantity: "100" })
  await receiveStock(ctx, beans.id, { locationId: shop.id, quantity: "3" })
  await receiveStock(ctx, beans.id, { locationId: back.id, quantity: "50" })
  const till = await saveRegister(ctx, null, { name: "Front till", locationId: shop.id })
  return { org, ctx, shop, back, latte, beans, till }
}

type S = Awaited<ReturnType<typeof setup>>

const sale = (s: S, extra: Partial<CheckoutInput> = {}): CheckoutInput => ({
  registerId: s.till.id,
  clientKey: randomUUID(),
  lines: [{ productId: s.latte.id, quantity: "2" }],
  payments: [{ tender: "cash", amount: "10" }],
  ...extra,
})

const onHandAt = async (s: S, productId: string, locationId: string) =>
  (await getProduct(s.ctx, productId)).levels.find((l) => l.locationId === locationId)
    ?.quantityMilli ?? 0

describe("till math", () => {
  it("takes tax out of inclusive prices and adds it to exclusive ones, after the discount", () => {
    // 2 × 4.50 = 9.00, 10% off = 8.10; 12% VAT inside 8.10 is 0.87.
    expect(
      computeLine(
        { quantityMilli: 2000, unitPriceCents: 450, discountBp: 1000 },
        { taxRateBp: 1200, pricesIncludeTax: true },
      ),
    ).toMatchObject({ subtotalCents: 900, discountCents: 90, taxCents: 87, totalCents: 810 })
    expect(
      computeLine(
        { quantityMilli: 2000, unitPriceCents: 450, discountBp: 1000 },
        { taxRateBp: 1200, pricesIncludeTax: false },
      ),
    ).toMatchObject({ subtotalCents: 900, discountCents: 90, taxCents: 97, totalCents: 907 })
    const cart = computeCart(
      [
        { quantityMilli: 1000, unitPriceCents: 333, discountBp: 0 },
        { quantityMilli: 1500, unitPriceCents: 1000, discountBp: 0 },
      ],
      { taxRateBp: 0, pricesIncludeTax: true },
    )
    expect(cart).toMatchObject({ subtotalCents: 1833, totalCents: 1833, taxCents: 0 })
  })

  it("settles split payments with change from cash only", () => {
    const r = settlePayments(907, [
      { tender: "card", tenderedCents: 500 },
      { tender: "cash", tenderedCents: 1000 },
    ])
    expect(r).toMatchObject({ ok: true, changeCents: 593 })
    expect(r.ok && r.payments.map((p) => [p.tender, p.amountCents, p.changeCents])).toEqual([
      ["card", 500, 0],
      ["cash", 407, 593],
    ])
    expect(settlePayments(907, [{ tender: "card", tenderedCents: 1000 }])).toMatchObject({
      ok: false,
      error: "Card and other payments can't be more than the total",
    })
    expect(settlePayments(907, [{ tender: "cash", tenderedCents: 900 }])).toMatchObject({
      ok: false,
      dueCents: 7,
    })
    expect(settlePayments(0, [])).toMatchObject({ ok: true, changeCents: 0, payments: [] })
  })

  it("splits refunds so refunding everything returns exactly what was paid", () => {
    const line = { quantityMilli: 3000, totalCents: 1000, refundedQtyMilli: 0, refundedCents: 0 }
    const a = refundAmount(line, 1000)
    const b = refundAmount({ ...line, refundedQtyMilli: 1000, refundedCents: a }, 1000)
    const c = refundAmount({ ...line, refundedQtyMilli: 2000, refundedCents: a + b }, 1000)
    expect([a, b, c]).toEqual([333, 333, 334])
    expect(a + b + c).toBe(1000)
  })
})

describe("selling", () => {
  it("rings up a sale from catalog prices, takes stock from the till's location and gives change", async () => {
    const s = await setup()
    const shift = await openShift(s.ctx, s.till.id, { openingFloat: "100" })
    const r = await checkout(
      s.ctx,
      sale(s, {
        lines: [
          // A tampered price for a product line is ignored: the shelf price wins.
          { productId: s.latte.id, quantity: "2", unitPrice: "0.01", discount: "10" },
          { productId: s.beans.id, quantity: "1" },
          { description: "Gift wrap", quantity: "1", unitPrice: "1.50" },
        ],
        payments: [{ tender: "cash", amount: "30" }],
      }),
    )
    expect(r.replay).toBe(false)
    expect(r.changeCents).toBe(3000 - (810 + 1200 + 150))
    expect(r.sale).toMatchObject({
      number: "R-00001",
      shiftId: shift.id,
      subtotalCents: 900 + 1200 + 150,
      discountCents: 90,
      totalCents: 2160,
    })
    const full = await getSale(s.ctx, r.sale.id)
    expect(full.lines.map((l) => [l.description, l.unitPriceCents, l.totalCents])).toEqual([
      ["Latte", 450, 810],
      ["Beans 250g", 1200, 1200],
      ["Gift wrap", 150, 150],
    ])
    expect(full.payments).toMatchObject([
      { tender: "cash", amountCents: 2160, tenderedCents: 3000, changeCents: 840 },
    ])
    expect(await onHandAt(s, s.latte.id, s.shop.id)).toBe(98_000)
    expect(await onHandAt(s, s.beans.id, s.shop.id)).toBe(2000)
    // The back room isn't touched.
    expect(await onHandAt(s, s.beans.id, s.back.id)).toBe(50_000)
  })

  it("needs an open shift, a manager for big discounts, and active products in the till's currency", async () => {
    const s = await setup()
    await expect(checkout(s.ctx, sale(s))).rejects.toMatchObject({
      status: 409,
      message: "Open a shift on this register first.",
    })
    await openShift(s.ctx, s.till.id, { openingFloat: "0" })
    const big = sale(s, { lines: [{ productId: s.latte.id, quantity: "1", discount: "50" }] })
    await expect(checkout(s.ctx, big)).rejects.toMatchObject({
      fieldErrors: { "lines.0.discount": "Up to 10% without a manager" },
    })
    await expect(checkout(s.ctx, big, { canOverrideDiscount: true })).resolves.toMatchObject({
      sale: { totalCents: 225 },
    })

    const euro = await createProduct(s.ctx, {
      sku: "EU",
      name: "Euro mug",
      unit: "pcs",
      currency: "EUR",
      price: "9",
    })
    await setProductStatus(s.ctx, s.beans.id, "archived")
    await expect(
      checkout(
        s.ctx,
        sale(s, {
          lines: [
            { productId: euro.id, quantity: "1" },
            { productId: s.beans.id, quantity: "1" },
          ],
        }),
      ),
    ).rejects.toMatchObject({
      fieldErrors: {
        "lines.0.productId": "Euro mug is priced in EUR, not USD",
        "lines.1.productId": "Beans 250g is archived",
      },
    })
    await expect(
      checkout(s.ctx, sale(s, { payments: [{ tender: "cash", amount: "5" }] })),
    ).rejects.toMatchObject({ fieldErrors: { payments: "$4.00 still to pay" } })
  })

  it("never charges twice for the same sale key, even when sent at the same moment", async () => {
    const s = await setup()
    await openShift(s.ctx, s.till.id, { openingFloat: "0" })
    const input = sale(s)
    const all = await Promise.all(Array.from({ length: 5 }, () => checkout(s.ctx, input)))
    expect(new Set(all.map((r) => r.sale.id)).size).toBe(1)
    expect(all.filter((r) => !r.replay)).toHaveLength(1)
    expect(await onHandAt(s, s.latte.id, s.shop.id)).toBe(98_000)
    // The same key from another register is refused rather than returning someone else's sale.
    const other = await saveRegister(s.ctx, null, { name: "Bar", locationId: s.shop.id })
    await expect(checkout(s.ctx, { ...input, registerId: other.id })).rejects.toMatchObject({
      status: 409,
    })
  })

  it("doesn't oversell when the last items go at once, and saves nothing for a short sale", async () => {
    const s = await setup()
    await openShift(s.ctx, s.till.id, { openingFloat: "0" })
    const one = () =>
      checkout(
        s.ctx,
        sale(s, {
          lines: [{ productId: s.beans.id, quantity: "1" }],
          payments: [{ tender: "card", amount: "12" }],
        }),
      )
    const tries = await Promise.allSettled(Array.from({ length: 5 }, one))
    const ok = tries.filter((t) => t.status === "fulfilled")
    expect(ok).toHaveLength(3)
    const numbers = ok.map(
      (t) => (t as PromiseFulfilledResult<Awaited<ReturnType<typeof one>>>).value.sale.number,
    )
    expect(numbers.sort()).toEqual(["R-00001", "R-00002", "R-00003"])
    expect(await onHandAt(s, s.beans.id, s.shop.id)).toBe(0)
    const failed = tries.find((t) => t.status === "rejected") as PromiseRejectedResult
    expect(failed.reason).toMatchObject({
      status: 409,
      fieldErrors: { "lines.0.quantity": "Only 0 pcs of Beans 250g at Shop floor" },
    })
    // Failed sales roll back completely, receipt number included.
    const next = await checkout(s.ctx, sale(s))
    expect(next.sale.number).toBe("R-00004")
    expect((await listSales(s.ctx)).total).toBe(4)
  })
})

describe("refunds", () => {
  it("refunds part then the rest, never more than sold, and can restock", async () => {
    const s = await setup()
    await openShift(s.ctx, s.till.id, { openingFloat: "50" })
    const { sale: sold } = await checkout(
      s.ctx,
      sale(s, {
        lines: [{ productId: s.latte.id, quantity: "3" }],
        payments: [{ tender: "card", amount: "13.50", reference: "VISA 4242" }],
      }),
    )
    const [line] = (await getSale(s.ctx, sold.id)).lines
    if (!line) throw new Error("no line")
    const first = await refundSale(s.ctx, sold.id, {
      registerId: s.till.id,
      tender: "card",
      reason: "Spilled",
      restock: false,
      lines: [{ lineId: line.id, quantity: "1" }],
    })
    expect(first.amountCents).toBe(450)
    await expect(
      refundSale(s.ctx, sold.id, {
        registerId: s.till.id,
        tender: "card",
        reason: "Too many",
        lines: [{ lineId: line.id, quantity: "3" }],
      }),
    ).rejects.toMatchObject({ fieldErrors: { "lines.0.quantity": "Only 2 left to refund" } })
    const rest = await refundSale(s.ctx, sold.id, {
      registerId: s.till.id,
      tender: "cash",
      reason: "Changed mind",
      restock: true,
      lines: [{ lineId: line.id, quantity: "2" }],
    })
    expect(rest).toMatchObject({ amountCents: 900, restocked: true })
    const after = await getSale(s.ctx, sold.id)
    expect(after.sale.refundedCents).toBe(1350)
    expect(after.refundedAll).toBe(true)
    expect(after.refunds).toHaveLength(2)
    // 3 sold, 2 back on the shelf.
    expect(await onHandAt(s, s.latte.id, s.shop.id)).toBe(99_000)
    await expect(
      refundSale(s.ctx, sold.id, {
        registerId: s.till.id,
        tender: "cash",
        reason: "Again",
        lines: [{ lineId: line.id, quantity: "1" }],
      }),
    ).rejects.toMatchObject({ fieldErrors: { "lines.0.quantity": "Already refunded" } })
  })

  it("gives the money back only once when two refunds race, and not more cash than the drawer holds", async () => {
    const s = await setup()
    await openShift(s.ctx, s.till.id, { openingFloat: "0" })
    const { sale: sold } = await checkout(
      s.ctx,
      sale(s, {
        lines: [{ productId: s.beans.id, quantity: "2" }],
        payments: [{ tender: "card", amount: "24" }],
      }),
    )
    const lineId = (await getSale(s.ctx, sold.id)).lines[0]?.id as string
    // The drawer is empty: a cash refund can't come out of it.
    await expect(
      refundSale(s.ctx, sold.id, {
        registerId: s.till.id,
        tender: "cash",
        reason: "Broken",
        lines: [{ lineId, quantity: "1" }],
      }),
    ).rejects.toMatchObject({ fieldErrors: { tender: "Only $0.00 should be in the drawer" } })
    const tries = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        refundSale(s.ctx, sold.id, {
          registerId: s.till.id,
          tender: "card",
          reason: "Broken",
          lines: [{ lineId, quantity: "2" }],
        }),
      ),
    )
    expect(tries.filter((t) => t.status === "fulfilled")).toHaveLength(1)
    expect((await getSale(s.ctx, sold.id)).sale.refundedCents).toBe(2400)
  })
})

describe("shifts and the drawer", () => {
  it("works out the expected cash, records the count and tells owners when it's short", async () => {
    const s = await setup()
    const cashier = await addMember(s.org, "member")
    const cctx = ctxOf(s.org.orgId, cashier)
    const shift = await openShift(cctx, s.till.id, { openingFloat: "100" })
    await expect(openShift(cctx, s.till.id, { openingFloat: "0" })).rejects.toMatchObject({
      status: 409,
      message: "A shift is already open on this register.",
    })
    // 9.00 cash (20 handed over), 4.50 on card.
    await checkout(cctx, sale(s, { payments: [{ tender: "cash", amount: "20" }] }))
    const { sale: carded } = await checkout(
      cctx,
      sale(s, {
        lines: [{ productId: s.latte.id, quantity: "1" }],
        payments: [{ tender: "card", amount: "4.50" }],
      }),
    )
    await recordCashMovement(cctx, shift.id, {
      kind: "paid_in",
      amount: "20",
      reason: "Change from bank",
    })
    await recordCashMovement(cctx, shift.id, { kind: "paid_out", amount: "5", reason: "Milk" })
    await expect(
      recordCashMovement(cctx, shift.id, { kind: "paid_out", amount: "500", reason: "Too much" }),
    ).rejects.toMatchObject({ fieldErrors: { amount: "Only $124.00 should be in the drawer" } })
    await refundSale(s.ctx, carded.id, {
      registerId: s.till.id,
      tender: "cash",
      reason: "Wrong order",
      lines: [{ lineId: (await getSale(s.ctx, carded.id)).lines[0]?.id as string, quantity: "1" }],
    })
    // 100 + 9 + 20 − 5 − 4.50 = 119.50
    const live = await shiftReport(s.ctx, shift.id)
    expect(live.drawer.expectedCents).toBe(11_950)
    expect(live.totals).toMatchObject({ sales: 2, totalCents: 1350, refundsCents: 450 })
    expect(live.tenders).toEqual([
      { tender: "cash", salesCents: 900, refundsCents: 450 },
      { tender: "card", salesCents: 450, refundsCents: 0 },
      { tender: "other", salesCents: 0, refundsCents: 0 },
    ])

    const closed = await closeShift(cctx, shift.id, { countedCash: "117.50", note: "Busy rush" })
    expect(closed).toMatchObject({
      status: "closed",
      expectedCashCents: 11_950,
      countedCashCents: 11_750,
      varianceCents: -200,
    })
    const inbox = await listNotifications({ userId: s.org.id, orgId: s.org.orgId })
    expect(inbox.map((n) => n.title)).toContain("Front till closed $2.00 short")

    await expect(checkout(cctx, sale(s))).rejects.toMatchObject({ status: 409 })
    await expect(
      recordCashMovement(cctx, shift.id, { kind: "paid_in", amount: "1", reason: "Late" }),
    ).rejects.toMatchObject({ status: 409 })
    await expect(closeShift(cctx, shift.id, { countedCash: "0" })).rejects.toMatchObject({
      status: 409,
    })
    // A new shift can start once the old one is closed.
    await expect(openShift(cctx, s.till.id, { openingFloat: "50" })).resolves.toMatchObject({
      status: "open",
    })
  })

  it("sums the day in the business's time zone", async () => {
    const s = await setup()
    await openShift(s.ctx, s.till.id, { openingFloat: "0" })
    await checkout(s.ctx, sale(s))
    await checkout(
      s.ctx,
      sale(s, {
        lines: [{ productId: s.beans.id, quantity: "1" }],
        payments: [{ tender: "card", amount: "12" }],
      }),
    )
    const sum = await salesSummary(s.ctx)
    expect(sum).toMatchObject({
      sales: 2,
      grossCents: 2100,
      netCents: 2100,
      averageCents: 1050,
      timeZone: "Asia/Manila",
    })
    expect(sum.tenders).toEqual([
      { tender: "cash", cents: 900 },
      { tender: "card", cents: 1200 },
      { tender: "other", cents: 0 },
    ])
    expect(sum.top[0]).toMatchObject({ description: "Beans 250g", cents: 1200 })
    expect(sum.hours.reduce((n, h) => n + h.sales, 0)).toBe(2)
    expect((await salesSummary(s.ctx, "2020-01-01")).sales).toBe(0)
  })
})

describe("records can't be rewritten", () => {
  it("refuses edits and deletes in the database, but lets deleted users and orgs go", async () => {
    const s = await setup()
    const cashier = await addMember(s.org, "member")
    const cctx = ctxOf(s.org.orgId, cashier)
    const shift = await openShift(cctx, s.till.id, { openingFloat: "10" })
    const { sale: sold } = await checkout(cctx, sale(s))

    await expect(
      db.update(posSale).set({ totalCents: 1 }).where(eq(posSale.id, sold.id)),
    ).rejects.toThrow()
    await expect(db.delete(posSale).where(eq(posSale.id, sold.id))).rejects.toThrow()
    await expect(
      db.update(posSaleLine).set({ unitPriceCents: 1 }).where(eq(posSaleLine.saleId, sold.id)),
    ).rejects.toThrow()
    await expect(
      db.update(posPayment).set({ amountCents: 1 }).where(eq(posPayment.saleId, sold.id)),
    ).rejects.toThrow()
    await expect(
      db.update(posSale).set({ refundedCents: 99_999 }).where(eq(posSale.id, sold.id)),
    ).rejects.toThrow()

    await closeShift(cctx, shift.id, { countedCash: "19" })
    await expect(
      db.update(posShift).set({ countedCashCents: 1_900_00 }).where(eq(posShift.id, shift.id)),
    ).rejects.toThrow()
    await expect(
      db.update(posShift).set({ status: "open" }).where(eq(posShift.id, shift.id)),
    ).rejects.toThrow()
    // A sale can't be slipped into the closed shift even by writing to the table directly.
    await expect(
      db.insert(posSale).values({
        ...sold,
        id: randomUUID(),
        number: "R-99999",
        clientKey: randomUUID(),
        refundedCents: 0,
      }),
    ).rejects.toThrow()

    // ON DELETE SET NULL for a removed account may clear the name links, and nothing else.
    await db.update(posSale).set({ cashierId: null }).where(eq(posSale.id, sold.id))
    await db
      .update(posShift)
      .set({ openedBy: null, closedBy: null })
      .where(eq(posShift.id, shift.id))
    await expect(
      db.update(posSale).set({ cashierId: s.org.id }).where(eq(posSale.id, sold.id)),
    ).rejects.toThrow()
    const [kept] = await db.select().from(posSale).where(eq(posSale.id, sold.id))
    expect(kept).toMatchObject({ cashierId: null, totalCents: 900 })

    // Deleting the organization takes everything with it.
    await db.delete(organization).where(eq(organization.id, s.org.orgId))
    expect(await db.select().from(posSale).where(eq(posSale.orgId, s.org.orgId))).toHaveLength(0)
    expect(await db.select().from(posShift).where(eq(posShift.orgId, s.org.orgId))).toHaveLength(0)
  })
})

describe("tenancy", () => {
  it("can't see or use another org's sales, registers or products", async () => {
    const a = await setup()
    const b = await setup()
    await openShift(a.ctx, a.till.id, { openingFloat: "0" })
    await openShift(b.ctx, b.till.id, { openingFloat: "0" })
    const { sale: sold } = await checkout(a.ctx, sale(a))

    await expect(getSale(b.ctx, sold.id)).rejects.toMatchObject({ status: 404 })
    await expect(
      refundSale(b.ctx, sold.id, {
        registerId: b.till.id,
        tender: "card",
        reason: "x",
        lines: [{ lineId: randomUUID(), quantity: "1" }],
      }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(checkout(b.ctx, sale(a, { registerId: a.till.id }))).rejects.toMatchObject({
      status: 404,
    })
    await expect(
      checkout(b.ctx, sale(b, { lines: [{ productId: a.latte.id, quantity: "1" }] })),
    ).rejects.toMatchObject({
      fieldErrors: { "lines.0.productId": "Choose a product from the list" },
    })
    await expect(
      saveRegister(b.ctx, null, { name: "Sneaky", locationId: a.shop.id }),
    ).rejects.toMatchObject({ fieldErrors: { locationId: "Choose a location from the list" } })
    // Reusing A's sale key in B makes a new sale in B, never returns A's.
    const mine = await checkout(b.ctx, sale(b, { clientKey: sold.clientKey }))
    expect(mine.replay).toBe(false)
    expect(mine.sale.orgId).toBe(b.org.orgId)
    expect((await listSales(b.ctx)).rows.map((r) => r.id)).toEqual([mine.sale.id])
  })
})

describe("permissions", () => {
  it.each([
    ["member", { pos: ["read", "sell"] }, true],
    ["member", { pos: ["refund"] }, false],
    ["member", { pos: ["manage"] }, false],
    ["admin", { pos: ["refund", "manage"] }, true],
  ] as const)("%s → %j is %s", async (role, permissions, expected) => {
    const org = await newOrgOwner("Acme")
    const m = await addMember(org, role)
    expect(
      (await m.client.call("/organization/has-permission", { permissions })).data.success,
    ).toBe(expected)
  })
})
