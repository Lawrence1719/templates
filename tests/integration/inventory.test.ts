import { listAuditLog } from "@templates/audit"
import { db } from "@templates/db"
import { MOVEMENT_KINDS as DB_KINDS, stockLevel, stockMovement } from "@templates/db/schema"
import {
  countStock,
  createLocation,
  createProduct,
  deleteProduct,
  getProduct,
  inventorySummary,
  issueStock,
  listLocations,
  listMovements,
  listProducts,
  MOVEMENT_KINDS,
  movementsCsv,
  type ProductInput,
  parseQuantity,
  receiveStock,
  reorderList,
  setLocationStatus,
  setProductStatus,
  stockStatus,
  stockValue,
  suggestedOrder,
  transferStock,
  updateProduct,
} from "@templates/inventory"
import { listNotifications } from "@templates/notifications"
import { eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { addMember, newOrgOwner } from "../setup/client"

type Person = { id: string; name: string; email: string }
const ctxOf = (orgId: string, u: Person) => ({
  orgId,
  user: { id: u.id, name: u.name, email: u.email },
})

const beans: ProductInput = {
  sku: "BEAN-1KG",
  name: "Coffee beans",
  unit: "kg",
  currency: "USD",
  cost: "12.50",
  price: "20",
  reorderPoint: "10",
  reorderQty: "50",
}

async function setup() {
  const org = await newOrgOwner("Acme")
  const ctx = ctxOf(org.orgId, org)
  const [p, main, store] = await Promise.all([
    createProduct(ctx, beans),
    createLocation(ctx, { name: "Main warehouse" }),
    createLocation(ctx, { name: "Downtown store" }),
  ])
  return { org, ctx, p, main, store }
}

const onHandAt = async (productId: string, locationId: string) => {
  const all = await db.select().from(stockLevel).where(eq(stockLevel.productId, productId))
  return all.find((x) => x.locationId === locationId)?.quantityMilli ?? 0
}

describe("helpers", () => {
  it("parses quantities exactly and works out value and status", () => {
    expect(parseQuantity("2.5")).toBe(2500)
    expect(parseQuantity("0")).toBeNull()
    expect(parseQuantity("0", { allowZero: true })).toBe(0)
    expect(parseQuantity("1.2345")).toBeNull()
    expect(stockValue(2500, 1250)).toBe(3125) // 2.5 kg × $12.50
    expect(stockValue(1, 333)).toBe(0) // 0.001 × $3.33 rounds to 0
    expect(stockStatus(0, 10_000)).toBe("out")
    expect(stockStatus(10_000, 10_000)).toBe("low")
    expect(stockStatus(10_001, 10_000)).toBe("ok")
    expect(suggestedOrder(4000, 10_000, 50_000)).toBe(50_000)
    expect(suggestedOrder(4000, 10_000, 0)).toBe(7000)
  })

  it("keeps movement kinds in sync between the module and the schema", () => {
    expect(MOVEMENT_KINDS).toEqual(DB_KINDS)
  })
})

describe("catalog", () => {
  it("keeps SKUs unique per org, ignoring case", async () => {
    const { ctx } = await setup()
    await expect(createProduct(ctx, { ...beans, sku: "bean-1kg" })).rejects.toMatchObject({
      fieldErrors: { sku: "Another product already uses this SKU" },
    })
    // Another org can use the same SKU.
    const other = await newOrgOwner("Other")
    await expect(createProduct(ctxOf(other.orgId, other), beans)).resolves.toBeTruthy()
  })

  it.each([
    [{ sku: "has space" }, "sku", "Letters, numbers, . _ / and - only"],
    [{ cost: "-1" }, "cost", "Enter an amount like 12 or 12.50"],
    [{ reorderPoint: "abc" }, "reorderPoint", "Enter a quantity like 10"],
    [{ unit: "" }, "unit", "Enter a unit like pcs or kg"],
  ])("rejects %j", async (patch, field, message) => {
    const { ctx } = await setup()
    await expect(createProduct(ctx, { ...beans, sku: "X-1", ...patch })).rejects.toMatchObject({
      fieldErrors: { [field]: message },
    })
  })

  it("deletes products with no history, archives the rest", async () => {
    const { ctx, p, main } = await setup()
    const spare = await createProduct(ctx, { ...beans, sku: "SPARE" })
    await deleteProduct(ctx, spare.id)
    await receiveStock(ctx, p.id, { locationId: main.id, quantity: "5" })
    await expect(deleteProduct(ctx, p.id)).rejects.toMatchObject({ status: 409 })
    await setProductStatus(ctx, p.id, "archived")
    await expect(
      receiveStock(ctx, p.id, { locationId: main.id, quantity: "1" }),
    ).rejects.toMatchObject({
      status: 409,
    })
  })
})

describe("moving stock", () => {
  it("receives, issues and keeps a running balance in the ledger", async () => {
    const { ctx, p, main } = await setup()
    await receiveStock(ctx, p.id, {
      locationId: main.id,
      quantity: "25.5",
      unitCost: "12",
      reference: "PO-1001",
    })
    await issueStock(ctx, p.id, {
      locationId: main.id,
      quantity: "3.25",
      reason: "sold",
      reference: "INV-0001",
    })
    const { onHandMilli, movements } = await getProduct(ctx, p.id)
    expect(onHandMilli).toBe(22_250)
    expect(movements.map((m) => [m.kind, m.quantityMilli, m.balanceAfterMilli])).toEqual([
      ["issue", -3250, 22_250],
      ["receive", 25_500, 25_500],
    ])
  })

  it("never goes below zero, with a clear message", async () => {
    const { ctx, p, main } = await setup()
    await receiveStock(ctx, p.id, { locationId: main.id, quantity: "2" })
    await expect(
      issueStock(ctx, p.id, { locationId: main.id, quantity: "2.5", reason: "used" }),
    ).rejects.toMatchObject({ fieldErrors: { quantity: "Only 2 kg on hand there" } })
    expect(await onHandAt(p.id, main.id)).toBe(2000)
  })

  it("doesn't oversell when issues happen at the same moment", async () => {
    const { ctx, p, main } = await setup()
    await receiveStock(ctx, p.id, { locationId: main.id, quantity: "5" })
    const tries = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        issueStock(ctx, p.id, { locationId: main.id, quantity: "1", reason: "sold" }),
      ),
    )
    expect(tries.filter((t) => t.status === "fulfilled")).toHaveLength(5)
    expect(await onHandAt(p.id, main.id)).toBe(0)
  })

  it("transfers both sides or neither", async () => {
    const { ctx, p, main, store } = await setup()
    await receiveStock(ctx, p.id, { locationId: main.id, quantity: "10" })
    const t = await transferStock(ctx, p.id, {
      fromLocationId: main.id,
      toLocationId: store.id,
      quantity: "4",
    })
    expect(t.out?.transferId).toBe(t.into?.transferId)
    expect([await onHandAt(p.id, main.id), await onHandAt(p.id, store.id)]).toEqual([6000, 4000])

    await expect(
      transferStock(ctx, p.id, {
        fromLocationId: main.id,
        toLocationId: store.id,
        quantity: "100",
      }),
    ).rejects.toMatchObject({ status: 400 })
    expect([await onHandAt(p.id, main.id), await onHandAt(p.id, store.id)]).toEqual([6000, 4000])
    await expect(
      transferStock(ctx, p.id, { fromLocationId: main.id, toLocationId: main.id, quantity: "1" }),
    ).rejects.toMatchObject({ fieldErrors: { toLocationId: "Pick a different location" } })
  })

  it("survives opposite transfers at the same moment without deadlocking", async () => {
    const { ctx, p, main, store } = await setup()
    await receiveStock(ctx, p.id, { locationId: main.id, quantity: "20" })
    await receiveStock(ctx, p.id, { locationId: store.id, quantity: "20" })
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        transferStock(ctx, p.id, {
          fromLocationId: i % 2 ? main.id : store.id,
          toLocationId: i % 2 ? store.id : main.id,
          quantity: "1",
        }),
      ),
    )
    expect((await getProduct(ctx, p.id)).onHandMilli).toBe(40_000)
  })

  it("counts set the quantity and record the difference, even when it matches", async () => {
    const { org, ctx, p, main } = await setup()
    await receiveStock(ctx, p.id, { locationId: main.id, quantity: "12" })
    const c1 = await countStock(ctx, p.id, { locationId: main.id, counted: "11.5" })
    expect(c1?.quantityMilli).toBe(-500)
    const c2 = await countStock(ctx, p.id, { locationId: main.id, counted: "11.5" })
    expect(c2?.quantityMilli).toBe(0)
    expect(await onHandAt(p.id, main.id)).toBe(11_500)
    const log = await listAuditLog(org.orgId, { page: 1 })
    expect(log.rows.filter((r) => r.action === "stock.counted")).toHaveLength(1)
  })

  it("won't receive into an archived location, or archive one that still holds stock", async () => {
    const { ctx, p, main, store } = await setup()
    await receiveStock(ctx, p.id, { locationId: main.id, quantity: "1" })
    await expect(setLocationStatus(ctx, main.id, "archived")).rejects.toMatchObject({ status: 409 })
    await setLocationStatus(ctx, store.id, "archived")
    await expect(
      receiveStock(ctx, p.id, { locationId: store.id, quantity: "1" }),
    ).rejects.toMatchObject({
      fieldErrors: { locationId: "That location is archived" },
    })
    expect((await listLocations(ctx)).map((l) => l.name)).toEqual(["Main warehouse"])
  })
})

describe("the ledger is append-only", () => {
  it("refuses edits and deletes, even with direct SQL", async () => {
    const { ctx, p, main } = await setup()
    const m = await receiveStock(ctx, p.id, { locationId: main.id, quantity: "5" })
    if (!m) throw new Error("no movement")
    await expect(
      db.update(stockMovement).set({ quantityMilli: 999 }).where(eq(stockMovement.id, m.id)),
    ).rejects.toThrow()
    await expect(db.delete(stockMovement).where(eq(stockMovement.id, m.id))).rejects.toThrow()
    await expect(
      db.update(stockLevel).set({ quantityMilli: -1 }).where(eq(stockLevel.productId, p.id)),
    ).rejects.toThrow()
  })
})

describe("alerts and reports", () => {
  it("tells owners and admins once when stock crosses the reorder point", async () => {
    const { org, ctx, p, main } = await setup()
    const admin = await addMember(org, "admin")
    const rep = await addMember(org, "member")
    await receiveStock(ctx, p.id, { locationId: main.id, quantity: "15" })
    await issueStock(ctx, p.id, { locationId: main.id, quantity: "4", reason: "sold" }) // 11: still above
    await issueStock(ctx, p.id, { locationId: main.id, quantity: "2", reason: "sold" }) // 9: crossed
    await issueStock(ctx, p.id, { locationId: main.id, quantity: "1", reason: "sold" }) // 8: already low
    const lows = async (id: string) =>
      (await listNotifications({ userId: id, orgId: org.orgId })).filter(
        (n) => n.type === "stock.low",
      )
    expect(await lows(admin.id)).toHaveLength(1)
    expect((await lows(org.id))[0]?.title).toBe("Low stock: Coffee beans (9 kg left)")
    expect(await lows(rep.id)).toHaveLength(0)
  })

  it("filters low and out of stock, values stock at cost and lists what to reorder", async () => {
    const { ctx, p, main } = await setup()
    const cups = await createProduct(ctx, {
      ...beans,
      sku: "CUP-12",
      name: "Cups",
      unit: "pcs",
      cost: "0.10",
      reorderPoint: "0",
    })
    const milk = await createProduct(ctx, {
      ...beans,
      sku: "MILK-1L",
      name: "Milk",
      unit: "L",
      cost: "1.20",
    })
    await receiveStock(ctx, p.id, { locationId: main.id, quantity: "8" }) // low
    await receiveStock(ctx, cups.id, { locationId: main.id, quantity: "1000" }) // ok (no point set)

    const names = async (stock?: "low" | "out") =>
      (await listProducts(ctx, { stock })).rows.map((r) => r.name)
    expect(await names()).toEqual(["Coffee beans", "Cups", "Milk"])
    expect(await names("low")).toEqual(["Coffee beans"])
    expect(await names("out")).toEqual(["Milk"])

    const s = await inventorySummary(ctx)
    expect(s).toMatchObject({
      products: 3,
      low: 1,
      out: 1,
      value: [{ currency: "USD", cents: 20_000 }],
    })
    expect((await reorderList(ctx)).map((r) => r.sku)).toEqual(["BEAN-1KG", "MILK-1L"])
    expect(milk).toBeTruthy()
  })

  it("lists and exports the ledger with filters, formula-safe", async () => {
    const { ctx, p, main, store } = await setup()
    await updateProduct(ctx, p.id, { ...beans, name: '=HYPERLINK("x")' })
    await receiveStock(ctx, p.id, { locationId: main.id, quantity: "3", reference: "PO-7" })
    await transferStock(ctx, p.id, {
      fromLocationId: main.id,
      toLocationId: store.id,
      quantity: "1",
    })
    expect((await listMovements(ctx)).total).toBe(3)
    expect((await listMovements(ctx, { kind: "receive" })).total).toBe(1)
    expect((await listMovements(ctx, { location: store.id })).total).toBe(1)
    const csv = await movementsCsv(ctx)
    expect(csv.split("\n")).toHaveLength(4)
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`)
    expect(csv).toContain('"PO-7"')
  })
})

describe("org isolation", () => {
  it("can't see or move another org's stock", async () => {
    const a = await setup()
    const b = await setup()
    await receiveStock(a.ctx, a.p.id, { locationId: a.main.id, quantity: "5" })
    await expect(getProduct(b.ctx, a.p.id)).rejects.toMatchObject({ status: 404 })
    await expect(
      issueStock(b.ctx, a.p.id, { locationId: b.main.id, quantity: "1", reason: "sold" }),
    ).rejects.toMatchObject({
      status: 404,
    })
    // B's own product into A's location: refused.
    await expect(
      receiveStock(b.ctx, b.p.id, { locationId: a.main.id, quantity: "1" }),
    ).rejects.toMatchObject({
      fieldErrors: { locationId: "Choose a location from the list" },
    })
    expect((await listProducts(b.ctx)).rows.map((r) => r.onHandMilli)).toEqual([0])
    expect((await listMovements(b.ctx)).total).toBe(0)
    // And the database refuses a level row mixing orgs.
    await expect(
      db
        .insert(stockLevel)
        .values({ orgId: b.org.orgId, productId: b.p.id, locationId: a.main.id, quantityMilli: 1 }),
    ).rejects.toThrow()
  })
})

describe("permissions", () => {
  it.each([
    ["member", { inventory: ["read", "move"] }, true],
    ["member", { inventory: ["adjust"] }, false],
    ["member", { inventory: ["manage"] }, false],
    ["admin", { inventory: ["adjust", "manage"] }, true],
  ] as const)("%s → %j is %s", async (role, permissions, expected) => {
    const org = await newOrgOwner("Acme")
    const m = await addMember(org, role)
    expect(
      (await m.client.call("/organization/has-permission", { permissions })).data.success,
    ).toBe(expected)
  })
})
