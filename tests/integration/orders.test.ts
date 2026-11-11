import { createCustomer } from "@templates/crm"
import { db } from "@templates/db"
import {
  ORDER_STATUSES as DB_STATUSES,
  salesOrder,
  salesOrderEvent,
  salesOrderLine,
} from "@templates/db/schema"
import {
  createLocation,
  createProduct,
  deleteProduct,
  getProduct,
  receiveStock,
} from "@templates/inventory"
import { getInvoice } from "@templates/invoicing"
import { listNotifications } from "@templates/notifications"
import {
  addOrderNote,
  cancelOrder,
  confirmOrder,
  createOrder,
  deleteDraftOrder,
  duplicateOrder,
  fulfillOrder,
  getOrder,
  invoiceOrder,
  listOrders,
  ORDER_STATUSES,
  type OrderInput,
  orderSummary,
  updateOrder,
} from "@templates/orders"
import { eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { addMember, newOrgOwner } from "../setup/client"

type Person = { id: string; name: string; email: string }
const ctxOf = (orgId: string, u: Person) => ({
  orgId,
  user: { id: u.id, name: u.name, email: u.email },
})

async function setup() {
  const org = await newOrgOwner("Acme")
  const ctx = ctxOf(org.orgId, org)
  const [cust, beans, cups, wh] = await Promise.all([
    createCustomer(ctx, { kind: "company", name: "Bluebay Cafe", status: "active" }),
    createProduct(ctx, {
      sku: "BEAN",
      name: "Beans",
      unit: "kg",
      currency: "USD",
      cost: "12",
      price: "22",
      reorderPoint: "5",
      reorderQty: "20",
    }),
    createProduct(ctx, {
      sku: "CUP",
      name: "Cups",
      unit: "pcs",
      currency: "USD",
      cost: "0.05",
      price: "0.10",
    }),
    createLocation(ctx, { name: "Warehouse" }),
  ])
  await receiveStock(ctx, beans.id, { locationId: wh.id, quantity: "10" })
  await receiveStock(ctx, cups.id, { locationId: wh.id, quantity: "500" })
  return { org, ctx, cust, beans, cups, wh }
}

const order = (
  s: Awaited<ReturnType<typeof setup>>,
  extra: Partial<OrderInput> = {},
): OrderInput => ({
  customerId: s.cust.id,
  orderDate: "2026-11-11",
  requestedOn: "2026-11-14",
  locationId: s.wh.id,
  currency: "USD",
  lines: [
    { productId: s.beans.id, description: "Beans", quantity: "4", unitPrice: "22", taxRate: "12" },
    { productId: s.cups.id, description: "Cups", quantity: "200", unitPrice: "0.10" },
    { description: "Delivery", quantity: "1", unitPrice: "15" },
  ],
  ...extra,
})

const onHand = async (ctx: Parameters<typeof getProduct>[0], id: string) =>
  (await getProduct(ctx, id)).onHandMilli

describe("orders", () => {
  it("keeps status lists in sync between the module and the schema", () => {
    expect(ORDER_STATUSES).toEqual(DB_STATUSES)
  })

  it("numbers orders in sequence, even when created at the same moment", async () => {
    const s = await setup()
    const made = await Promise.all(Array.from({ length: 5 }, () => createOrder(s.ctx, order(s))))
    expect(made.map((o) => o.number).sort()).toEqual([
      "SO-0001",
      "SO-0002",
      "SO-0003",
      "SO-0004",
      "SO-0005",
    ])
    expect(made[0]).toMatchObject({ subtotalCents: 12_300, taxCents: 1_056, totalCents: 13_356 })
  })

  it("only uses the org's own customers, products and active locations", async () => {
    const s = await setup()
    const other = await setup()
    await expect(
      createOrder(
        s.ctx,
        order(s, {
          customerId: other.cust.id,
          locationId: other.wh.id,
          lines: [{ productId: other.beans.id, description: "x", quantity: "1", unitPrice: "1" }],
        }),
      ),
    ).rejects.toMatchObject({
      fieldErrors: {
        customerId: "Choose a customer from the list",
        locationId: "Choose a location from the list",
        "lines.0.productId": "Choose a product from the list",
      },
    })
  })

  it("goes draft → confirmed → fulfilled, taking stock from the location in one go", async () => {
    const s = await setup()
    const o = await createOrder(s.ctx, order(s))
    await expect(fulfillOrder(s.ctx, o.id)).rejects.toMatchObject({ status: 409 })
    await confirmOrder(s.ctx, o.id)
    // Still editable after confirming.
    await updateOrder(
      s.ctx,
      o.id,
      order(s, { lines: order(s).lines.map((l, i) => (i === 0 ? { ...l, quantity: "6" } : l)) }),
    )
    const done = await fulfillOrder(s.ctx, o.id)
    expect(done.status).toBe("fulfilled")
    expect(await onHand(s.ctx, s.beans.id)).toBe(4000)
    expect(await onHand(s.ctx, s.cups.id)).toBe(300_000)
    const { movements } = await getProduct(s.ctx, s.beans.id)
    expect(movements[0]).toMatchObject({
      kind: "issue",
      reason: "sold",
      reference: o.number,
      quantityMilli: -6000,
    })

    const { events } = await getOrder(s.ctx, o.id)
    expect(events.map((e) => e.kind)).toEqual(["fulfilled", "edited", "confirmed", "created"])
    await expect(updateOrder(s.ctx, o.id, order(s))).rejects.toMatchObject({ status: 409 })
  })

  it("changes nothing when stock is short, and says which lines", async () => {
    const s = await setup()
    const o = await createOrder(
      s.ctx,
      order(s, {
        lines: [
          { productId: s.cups.id, description: "Cups", quantity: "100", unitPrice: "0.10" },
          { productId: s.beans.id, description: "Beans", quantity: "11", unitPrice: "22" },
        ],
      }),
    )
    await confirmOrder(s.ctx, o.id)
    await expect(fulfillOrder(s.ctx, o.id)).rejects.toMatchObject({
      status: 409,
      fieldErrors: { "lines.1": "Only 10 kg of Beans at Warehouse" },
    })
    expect(await onHand(s.ctx, s.cups.id)).toBe(500_000) // the cups line wasn't taken either
    expect((await getOrder(s.ctx, o.id)).order.status).toBe("confirmed")
  })

  it("never ships the same stock twice when two orders are fulfilled at once", async () => {
    const s = await setup()
    const one = {
      lines: [{ productId: s.beans.id, description: "Beans", quantity: "7", unitPrice: "22" }],
    }
    const a = await createOrder(s.ctx, order(s, one))
    const b = await createOrder(s.ctx, order(s, one))
    await Promise.all([confirmOrder(s.ctx, a.id), confirmOrder(s.ctx, b.id)])
    const r = await Promise.allSettled([fulfillOrder(s.ctx, a.id), fulfillOrder(s.ctx, b.id)])
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1)
    expect(await onHand(s.ctx, s.beans.id)).toBe(3000)
  })

  it("alerts on low stock after fulfilling, and orders without products need no location", async () => {
    const s = await setup()
    const admin = await addMember(s.org, "admin")
    const o = await createOrder(
      s.ctx,
      order(s, {
        lines: [{ productId: s.beans.id, description: "Beans", quantity: "6", unitPrice: "22" }],
      }),
    )
    await confirmOrder(s.ctx, o.id)
    await fulfillOrder(s.ctx, o.id)
    const inbox = await listNotifications({ userId: admin.id, orgId: s.org.orgId })
    expect(inbox.map((n) => n.type)).toEqual(
      expect.arrayContaining(["order.confirmed", "stock.low"]),
    )

    const service = await createOrder(
      s.ctx,
      order(s, {
        locationId: null,
        lines: [{ description: "Consulting", quantity: "2", unitPrice: "90" }],
      }),
    )
    await confirmOrder(s.ctx, service.id)
    expect((await fulfillOrder(s.ctx, service.id)).status).toBe("fulfilled")
  })

  it("cancels with a reason, tells the creator, and can't cancel once fulfilled", async () => {
    const s = await setup()
    const rep = await addMember(s.org, "member")
    const o = await createOrder(ctxOf(s.org.orgId, rep), order(s))
    await expect(cancelOrder(s.ctx, o.id, "  ")).rejects.toMatchObject({
      fieldErrors: { reason: "Say why it's cancelled" },
    })
    await cancelOrder(s.ctx, o.id, "Customer changed their mind")
    expect(
      (await listNotifications({ userId: rep.id, orgId: s.org.orgId })).map((n) => n.type),
    ).toContain("order.cancelled")
    await expect(confirmOrder(s.ctx, o.id)).rejects.toMatchObject({ status: 409 })

    const f = await createOrder(s.ctx, order(s))
    await confirmOrder(s.ctx, f.id)
    await fulfillOrder(s.ctx, f.id)
    await expect(cancelOrder(s.ctx, f.id, "oops")).rejects.toMatchObject({ status: 409 })
  })

  it("creates one draft invoice with the same lines and totals", async () => {
    const s = await setup()
    const o = await createOrder(s.ctx, order(s))
    await expect(invoiceOrder(s.ctx, o.id)).rejects.toMatchObject({ status: 409 })
    await confirmOrder(s.ctx, o.id)
    const inv = await invoiceOrder(s.ctx, o.id)
    expect(inv).toMatchObject({ status: "draft", totalCents: 13_356, customerId: s.cust.id })
    expect((await getInvoice(s.ctx, inv.id)).lines).toHaveLength(3)
    await expect(invoiceOrder(s.ctx, o.id)).rejects.toMatchObject({ status: 409 })
    expect((await getOrder(s.ctx, o.id)).invoice?.id).toBe(inv.id)
  })

  it("deletes drafts only, duplicates, takes notes, and lists with filters", async () => {
    const s = await setup()
    const d = await createOrder(s.ctx, order(s))
    const c = await duplicateOrder(s.ctx, d.id)
    await deleteDraftOrder(s.ctx, d.id)
    // A copy starts without a requested date; give it one.
    expect(c.requestedOn).toBeNull()
    await updateOrder(s.ctx, c.id, order(s))
    await confirmOrder(s.ctx, c.id)
    await expect(deleteDraftOrder(s.ctx, c.id)).rejects.toMatchObject({ status: 409 })
    await addOrderNote(s.ctx, c.id, "Leave at the back door")
    expect((await getOrder(s.ctx, c.id)).events[0]).toMatchObject({
      kind: "note",
      body: "Leave at the back door",
    })

    expect((await listOrders(s.ctx, { status: "confirmed" })).total).toBe(1)
    expect((await listOrders(s.ctx, { due: "1" }, "2026-11-20")).total).toBe(1)
    expect((await listOrders(s.ctx, { due: "1" }, "2026-11-12")).total).toBe(0)
    expect((await listOrders(s.ctx, { q: "bluebay" })).total).toBe(1)
    const sum = await orderSummary(s.ctx, "2026-11-20")
    expect(sum).toMatchObject({ open: [{ currency: "USD", cents: 13_356, n: 1 }], due: 1 })
  })

  it("a product used on an order can't be deleted, with a clear message", async () => {
    const s = await setup()
    const p = await createProduct(s.ctx, {
      sku: "NEW",
      name: "New",
      unit: "pcs",
      currency: "USD",
      cost: "1",
      price: "2",
    })
    await createOrder(
      s.ctx,
      order(s, { lines: [{ productId: p.id, description: "New", quantity: "1", unitPrice: "2" }] }),
    )
    await expect(deleteProduct(s.ctx, p.id)).rejects.toMatchObject({ status: 409 })
  })
})

describe("the database protects finished orders", () => {
  it("refuses edits, reopening, deletes and history changes after fulfillment", async () => {
    const s = await setup()
    const o = await createOrder(s.ctx, order(s))
    await confirmOrder(s.ctx, o.id)
    await fulfillOrder(s.ctx, o.id)
    const [line] = await db.select().from(salesOrderLine).where(eq(salesOrderLine.orderId, o.id))
    const [ev] = await db.select().from(salesOrderEvent).where(eq(salesOrderEvent.orderId, o.id))
    if (!line || !ev) throw new Error("missing rows")
    await expect(
      db.update(salesOrderLine).set({ unitPriceCents: 1 }).where(eq(salesOrderLine.id, line.id)),
    ).rejects.toThrow()
    await expect(
      db.update(salesOrder).set({ totalCents: 1 }).where(eq(salesOrder.id, o.id)),
    ).rejects.toThrow()
    await expect(
      db.update(salesOrder).set({ status: "confirmed" }).where(eq(salesOrder.id, o.id)),
    ).rejects.toThrow()
    await expect(db.delete(salesOrder).where(eq(salesOrder.id, o.id))).rejects.toThrow()
    await expect(
      db.update(salesOrderEvent).set({ body: "rewritten" }).where(eq(salesOrderEvent.id, ev.id)),
    ).rejects.toThrow()
    await expect(
      db.update(salesOrder).set({ number: "SO-9999" }).where(eq(salesOrder.id, o.id)),
    ).rejects.toThrow()
  })
})

describe("org isolation", () => {
  it("can't read, change, fulfill or invoice another org's orders", async () => {
    const a = await setup()
    const b = await setup()
    const o = await createOrder(a.ctx, order(a))
    const nf = { status: 404 }
    await expect(getOrder(b.ctx, o.id)).rejects.toMatchObject(nf)
    await expect(updateOrder(b.ctx, o.id, order(b))).rejects.toMatchObject(nf)
    await expect(confirmOrder(b.ctx, o.id)).rejects.toMatchObject(nf)
    await expect(fulfillOrder(b.ctx, o.id)).rejects.toMatchObject(nf)
    await expect(cancelOrder(b.ctx, o.id, "x")).rejects.toMatchObject(nf)
    await expect(invoiceOrder(b.ctx, o.id)).rejects.toMatchObject(nf)
    expect((await listOrders(b.ctx)).total).toBe(0)
  })
})

describe("permissions", () => {
  it.each([
    ["member", { order: ["read", "write", "confirm", "fulfill"] }, true],
    ["member", { order: ["cancel"] }, false],
    ["admin", { order: ["cancel"] }, true],
  ] as const)("%s → %j is %s", async (role, permissions, expected) => {
    const org = await newOrgOwner("Acme")
    const m = await addMember(org, role)
    expect(
      (await m.client.call("/organization/has-permission", { permissions })).data.success,
    ).toBe(expected)
  })
})
