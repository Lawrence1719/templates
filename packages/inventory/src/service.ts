import "server-only"

import { randomUUID } from "node:crypto"

import { audit } from "@templates/audit"
import { db } from "@templates/db"
import { location, product, stockLevel, stockMovement, user } from "@templates/db/schema"
import { membersWithRole, notify } from "@templates/notifications"
import { and, asc, count, desc, eq, gte, ilike, lt, or, type SQL, sql } from "drizzle-orm"
import { z } from "zod"

import {
  type CountInput,
  countInputSchema,
  fieldErrors,
  formatQuantity,
  type IssueInput,
  issueInputSchema,
  KIND_LABELS,
  type LocationInput,
  locationInputSchema,
  type MovementFilter,
  type MovementKind,
  movementFilterSchema,
  type ProductFilter,
  type ProductInput,
  productFilterSchema,
  productInputSchema,
  type ReceiveInput,
  receiveInputSchema,
  type TransferInput,
  transferInputSchema,
} from "./definitions"

export type InventoryContext = { orgId: string; user: { id: string; name: string; email: string } }

export class InventoryError extends Error {
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
const notFound = () => new InventoryError("Not found", 404)
const invalid = (fieldErrors: Record<string, string>) =>
  new InventoryError("Please fix the highlighted fields.", 400, fieldErrors)

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input)
  if (!r.success) throw invalid(fieldErrors(r.error))
  return r.data
}

const likeTerm = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
const pgCode = (e: unknown): string | undefined => {
  const err = e as { code?: string; cause?: unknown } | null
  return err?.code ?? (err?.cause ? pgCode(err.cause) : undefined)
}

// ---------- Lookups (scoped to ctx.orgId) ----------

async function ownProduct(ctx: Pick<InventoryContext, "orgId">, id: string) {
  if (!isUuid(id)) throw notFound()
  const [row] = await db
    .select()
    .from(product)
    .where(and(eq(product.id, id), eq(product.orgId, ctx.orgId)))
  if (!row) throw notFound()
  return row
}

async function ownLocation(ctx: Pick<InventoryContext, "orgId">, id: string, field = "locationId") {
  const [row] = isUuid(id)
    ? await db
        .select()
        .from(location)
        .where(and(eq(location.id, id), eq(location.orgId, ctx.orgId)))
    : []
  if (!row) throw invalid({ [field]: "Choose a location from the list" })
  return row
}

// ---------- Products ----------

/** Total on hand per product, across all locations. */
const onHand = db
  .select({
    productId: stockLevel.productId,
    qty: sql<number>`sum(${stockLevel.quantityMilli})`.as("qty"),
  })
  .from(stockLevel)
  .groupBy(stockLevel.productId)
  .as("on_hand")
const onHandQty = sql<number>`coalesce(${onHand.qty}, 0)::bigint`.mapWith(Number)

export async function listProducts(ctx: Pick<InventoryContext, "orgId">, f: ProductFilter = {}) {
  const filter = productFilterSchema.parse(f)
  const where: SQL[] = [eq(product.orgId, ctx.orgId), eq(product.status, filter.status)]
  if (filter.category) where.push(eq(product.category, filter.category))
  if (filter.q) {
    const term = likeTerm(filter.q)
    const search = or(
      ilike(product.name, term),
      ilike(product.sku, term),
      ilike(product.barcode, term),
    )
    if (search) where.push(search)
  }
  if (filter.stock === "out") where.push(sql`coalesce(${onHand.qty}, 0) <= 0`)
  if (filter.stock === "low")
    where.push(
      sql`${product.reorderPointMilli} > 0 and coalesce(${onHand.qty}, 0) > 0 and coalesce(${onHand.qty}, 0) <= ${product.reorderPointMilli}`,
    )
  const base = db
    .select({
      id: product.id,
      sku: product.sku,
      name: product.name,
      category: product.category,
      unit: product.unit,
      currency: product.currency,
      costCents: product.costCents,
      priceCents: product.priceCents,
      reorderPointMilli: product.reorderPointMilli,
      reorderQtyMilli: product.reorderQtyMilli,
      status: product.status,
      onHandMilli: onHandQty,
    })
    .from(product)
    .leftJoin(onHand, eq(onHand.productId, product.id))
    .where(and(...where))
  const [rows, [total]] = await Promise.all([
    base
      .orderBy(asc(product.name), asc(product.id))
      .limit(PAGE_SIZE)
      .offset((filter.page - 1) * PAGE_SIZE),
    db
      .select({ n: count() })
      .from(product)
      .leftJoin(onHand, eq(onHand.productId, product.id))
      .where(and(...where)),
  ])
  return { rows, total: total?.n ?? 0, page: filter.page, pageSize: PAGE_SIZE, filter }
}

export async function productCategories(ctx: Pick<InventoryContext, "orgId">) {
  const rows = await db
    .selectDistinct({ category: product.category })
    .from(product)
    .where(and(eq(product.orgId, ctx.orgId), sql`${product.category} is not null`))
    .orderBy(asc(product.category))
    .limit(200)
  return rows.map((r) => r.category as string)
}

export async function getProduct(ctx: Pick<InventoryContext, "orgId">, id: string) {
  const p = await ownProduct(ctx, id)
  const author = user
  const [levels, movements] = await Promise.all([
    db
      .select({
        locationId: location.id,
        locationName: location.name,
        locationStatus: location.status,
        quantityMilli: sql<number>`coalesce(${stockLevel.quantityMilli}, 0)::bigint`.mapWith(
          Number,
        ),
      })
      .from(location)
      .leftJoin(
        stockLevel,
        and(eq(stockLevel.locationId, location.id), eq(stockLevel.productId, p.id)),
      )
      .where(
        and(
          eq(location.orgId, ctx.orgId),
          or(eq(location.status, "active"), sql`${stockLevel.quantityMilli} > 0`),
        ),
      )
      .orderBy(asc(location.name)),
    db
      .select({
        id: stockMovement.id,
        kind: stockMovement.kind,
        quantityMilli: stockMovement.quantityMilli,
        balanceAfterMilli: stockMovement.balanceAfterMilli,
        reason: stockMovement.reason,
        reference: stockMovement.reference,
        note: stockMovement.note,
        createdAt: stockMovement.createdAt,
        locationName: location.name,
        byName: author.name,
      })
      .from(stockMovement)
      .innerJoin(location, eq(location.id, stockMovement.locationId))
      .leftJoin(author, eq(author.id, stockMovement.createdBy))
      .where(and(eq(stockMovement.productId, p.id), eq(stockMovement.orgId, ctx.orgId)))
      .orderBy(desc(stockMovement.createdAt))
      .limit(100),
  ])
  const total = levels.reduce((s, l) => s + l.quantityMilli, 0)
  return { product: p, levels, movements, onHandMilli: total }
}

async function saveProduct(ctx: InventoryContext, id: string | null, input: ProductInput) {
  const { cost, price, reorderPoint, reorderQty, ...v } = parse(productInputSchema, input)
  const values = {
    ...v,
    costCents: cost,
    priceCents: price,
    reorderPointMilli: reorderPoint,
    reorderQtyMilli: reorderQty,
  }
  try {
    if (id) {
      await ownProduct(ctx, id)
      const [row] = await db
        .update(product)
        .set(values)
        .where(and(eq(product.id, id), eq(product.orgId, ctx.orgId)))
        .returning()
      if (!row) throw notFound()
      return row
    }
    const [row] = await db
      .insert(product)
      .values({ ...values, orgId: ctx.orgId })
      .returning()
    if (!row) throw new Error("insert failed")
    await audit(ctx, "product.created", `Added product ${row.sku} ${row.name}`, {
      target: { type: "product", id: row.id },
    })
    return row
  } catch (e) {
    if (pgCode(e) === "23505") throw invalid({ sku: "Another product already uses this SKU" })
    throw e
  }
}

export const createProduct = (ctx: InventoryContext, input: ProductInput) =>
  saveProduct(ctx, null, input)
export const updateProduct = (ctx: InventoryContext, id: string, input: ProductInput) =>
  saveProduct(ctx, id, input)

export async function setProductStatus(
  ctx: InventoryContext,
  id: string,
  status: "active" | "archived",
) {
  const p = await ownProduct(ctx, id)
  if (p.status === status) return
  await db
    .update(product)
    .set({ status })
    .where(and(eq(product.id, id), eq(product.orgId, ctx.orgId)))
  await audit(
    ctx,
    `product.${status === "archived" ? "archived" : "restored"}`,
    `${status === "archived" ? "Archived" : "Restored"} ${p.sku}`,
    {
      target: { type: "product", id },
    },
  )
}

/** Only products with no stock history can be deleted; archive the rest. */
export async function deleteProduct(ctx: InventoryContext, id: string) {
  const p = await ownProduct(ctx, id)
  const [m] = await db
    .select({ n: count() })
    .from(stockMovement)
    .where(eq(stockMovement.productId, p.id))
  if ((m?.n ?? 0) > 0)
    throw new InventoryError("This product has stock history. Archive it instead.", 409)
  await db.delete(product).where(and(eq(product.id, id), eq(product.orgId, ctx.orgId)))
  await audit(ctx, "product.deleted", `Deleted product ${p.sku}`, {
    target: { type: "product", id },
  })
}

// ---------- Locations ----------

export async function listLocations(
  ctx: Pick<InventoryContext, "orgId">,
  opts: { includeArchived?: boolean } = {},
) {
  return db
    .select({
      id: location.id,
      name: location.name,
      address: location.address,
      status: location.status,
      products: sql<number>`count(${stockLevel.productId}) filter (where ${stockLevel.quantityMilli} > 0)::int`,
      units: sql<number>`coalesce(sum(${stockLevel.quantityMilli}), 0)::bigint`.mapWith(Number),
    })
    .from(location)
    .leftJoin(stockLevel, eq(stockLevel.locationId, location.id))
    .where(
      and(
        eq(location.orgId, ctx.orgId),
        opts.includeArchived ? undefined : eq(location.status, "active"),
      ),
    )
    .groupBy(location.id)
    .orderBy(asc(location.status), asc(location.name))
}

export async function createLocation(ctx: InventoryContext, input: LocationInput) {
  const v = parse(locationInputSchema, input)
  try {
    const [row] = await db
      .insert(location)
      .values({ ...v, orgId: ctx.orgId })
      .returning()
    if (!row) throw new Error("insert failed")
    await audit(ctx, "location.created", `Added location ${row.name}`, {
      target: { type: "location", id: row.id },
    })
    return row
  } catch (e) {
    if (pgCode(e) === "23505") throw invalid({ name: "You already have a location with this name" })
    throw e
  }
}

export async function updateLocation(ctx: InventoryContext, id: string, input: LocationInput) {
  await ownLocation(ctx, id)
  const v = parse(locationInputSchema, input)
  try {
    const [row] = await db
      .update(location)
      .set(v)
      .where(and(eq(location.id, id), eq(location.orgId, ctx.orgId)))
      .returning()
    return row
  } catch (e) {
    if (pgCode(e) === "23505") throw invalid({ name: "You already have a location with this name" })
    throw e
  }
}

/** A location can be archived once it's empty, so no stock is ever hidden. */
export async function setLocationStatus(
  ctx: InventoryContext,
  id: string,
  status: "active" | "archived",
) {
  const loc = await ownLocation(ctx, id)
  if (loc.status === status) return
  if (status === "archived") {
    const [held] = await db
      .select({ n: count() })
      .from(stockLevel)
      .where(and(eq(stockLevel.locationId, id), sql`${stockLevel.quantityMilli} > 0`))
    if ((held?.n ?? 0) > 0)
      throw new InventoryError("Move or count out the stock here before archiving it.", 409)
  }
  await db
    .update(location)
    .set({ status })
    .where(and(eq(location.id, id), eq(location.orgId, ctx.orgId)))
  await audit(
    ctx,
    `location.${status === "archived" ? "archived" : "restored"}`,
    `${status === "archived" ? "Archived" : "Restored"} location ${loc.name}`,
    {
      target: { type: "location", id },
    },
  )
}

// ---------- Moving stock ----------

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

type Move = {
  productId: string
  locationId: string
  kind: MovementKind
  delta: number
  reason?: string | null
  reference?: string | null
  note?: string | null
  unitCostCents?: number | null
  transferId?: string | null
}

/** Locks the level row (creating it at 0 if needed) and returns the quantity. */
async function lockLevel(tx: Tx, orgId: string, productId: string, locationId: string) {
  await tx
    .insert(stockLevel)
    .values({ orgId, productId, locationId, quantityMilli: 0 })
    .onConflictDoNothing()
  const [lvl] = await tx
    .select({ qty: stockLevel.quantityMilli })
    .from(stockLevel)
    .where(and(eq(stockLevel.productId, productId), eq(stockLevel.locationId, locationId)))
    .for("update")
  return lvl?.qty ?? 0
}

/** Applies one movement to a locked level. Refuses to go below zero. */
async function apply(
  tx: Tx,
  ctx: InventoryContext,
  m: Move,
  current: number,
  unit: string,
  field = "quantity",
) {
  const next = current + m.delta
  if (next < 0) throw invalid({ [field]: `Only ${formatQuantity(current, unit)} on hand there` })
  await tx
    .update(stockLevel)
    .set({ quantityMilli: next })
    .where(and(eq(stockLevel.productId, m.productId), eq(stockLevel.locationId, m.locationId)))
  const [row] = await tx
    .insert(stockMovement)
    .values({
      orgId: ctx.orgId,
      productId: m.productId,
      locationId: m.locationId,
      kind: m.kind,
      quantityMilli: m.delta,
      balanceAfterMilli: next,
      reason: m.reason ?? null,
      reference: m.reference ?? null,
      note: m.note ?? null,
      unitCostCents: m.unitCostCents ?? null,
      transferId: m.transferId ?? null,
      createdBy: ctx.user.id,
    })
    .returning()
  return row
}

async function totalOnHand(productId: string) {
  const [r] = await db
    .select({
      qty: sql<number>`coalesce(sum(${stockLevel.quantityMilli}), 0)::bigint`.mapWith(Number),
    })
    .from(stockLevel)
    .where(eq(stockLevel.productId, productId))
  return r?.qty ?? 0
}

/** Tells owners and admins once, when a product crosses down to its reorder point. */
async function alertIfLow(
  ctx: InventoryContext,
  p: { id: string; sku: string; name: string; unit: string; reorderPointMilli: number },
  before: number,
) {
  if (p.reorderPointMilli <= 0) return
  const after = await totalOnHand(p.id)
  if (before > p.reorderPointMilli && after <= p.reorderPointMilli) {
    const leads = await membersWithRole(ctx.orgId, ["owner", "admin"])
    await notify({
      orgId: ctx.orgId,
      to: leads,
      type: "stock.low",
      title:
        after <= 0
          ? `Out of stock: ${p.name}`
          : `Low stock: ${p.name} (${formatQuantity(after, p.unit)} left)`,
      body: `${p.sku} is at or below its reorder point of ${formatQuantity(p.reorderPointMilli, p.unit)}.`,
      link: `/inventory/${p.id}`,
    })
  }
}

async function activeProduct(ctx: Pick<InventoryContext, "orgId">, productId: string) {
  const p = await ownProduct(ctx, productId)
  if (p.status !== "active")
    throw new InventoryError("This product is archived. Restore it to move stock.", 409)
  return p
}

function activeLocation(loc: { status: string }, field = "locationId") {
  if (loc.status !== "active") throw invalid({ [field]: "That location is archived" })
}

export async function receiveStock(ctx: InventoryContext, productId: string, input: ReceiveInput) {
  const p = await activeProduct(ctx, productId)
  const v = parse(receiveInputSchema, input)
  activeLocation(await ownLocation(ctx, v.locationId))
  const movement = await db.transaction(async (tx) => {
    const current = await lockLevel(tx, ctx.orgId, p.id, v.locationId)
    return apply(
      tx,
      ctx,
      {
        productId: p.id,
        locationId: v.locationId,
        kind: "receive",
        delta: v.quantity,
        reference: v.reference,
        note: v.note,
        unitCostCents: v.unitCost,
      },
      current,
      p.unit,
    )
  })
  return movement
}

export async function issueStock(ctx: InventoryContext, productId: string, input: IssueInput) {
  const p = await ownProduct(ctx, productId)
  const v = parse(issueInputSchema, input)
  await ownLocation(ctx, v.locationId)
  const before = await totalOnHand(p.id)
  const movement = await db.transaction(async (tx) => {
    const current = await lockLevel(tx, ctx.orgId, p.id, v.locationId)
    return apply(
      tx,
      ctx,
      {
        productId: p.id,
        locationId: v.locationId,
        kind: "issue",
        delta: -v.quantity,
        reason: v.reason,
        reference: v.reference,
        note: v.note,
      },
      current,
      p.unit,
    )
  })
  await alertIfLow(ctx, p, before)
  return movement
}

/** Moves stock between two locations as one transaction: both sides or neither. */
export async function transferStock(
  ctx: InventoryContext,
  productId: string,
  input: TransferInput,
) {
  const p = await activeProduct(ctx, productId)
  const v = parse(transferInputSchema, input)
  const [, to] = await Promise.all([
    ownLocation(ctx, v.fromLocationId, "fromLocationId"),
    ownLocation(ctx, v.toLocationId, "toLocationId"),
  ])
  activeLocation(to, "toLocationId")
  const transferId = randomUUID()
  return db.transaction(async (tx) => {
    // Lock both rows in a fixed order so two opposite transfers can't deadlock.
    const ids = [v.fromLocationId, v.toLocationId].sort()
    const locked = new Map<string, number>()
    for (const loc of ids) locked.set(loc, await lockLevel(tx, ctx.orgId, p.id, loc))
    const out = await apply(
      tx,
      ctx,
      {
        productId: p.id,
        locationId: v.fromLocationId,
        kind: "transfer_out",
        delta: -v.quantity,
        note: v.note,
        transferId,
      },
      locked.get(v.fromLocationId) ?? 0,
      p.unit,
    )
    const into = await apply(
      tx,
      ctx,
      {
        productId: p.id,
        locationId: v.toLocationId,
        kind: "transfer_in",
        delta: v.quantity,
        note: v.note,
        transferId,
      },
      locked.get(v.toLocationId) ?? 0,
      p.unit,
    )
    return { out, into, transferId }
  })
}

/**
 * Records a stock count: sets on hand to what was counted, writing the
 * difference to the ledger (even zero, as proof the count happened).
 * Callers check `inventory: ["adjust"]`.
 */
export async function countStock(ctx: InventoryContext, productId: string, input: CountInput) {
  const p = await ownProduct(ctx, productId)
  const v = parse(countInputSchema, input)
  await ownLocation(ctx, v.locationId)
  const before = await totalOnHand(p.id)
  const movement = await db.transaction(async (tx) => {
    const current = await lockLevel(tx, ctx.orgId, p.id, v.locationId)
    return apply(
      tx,
      ctx,
      {
        productId: p.id,
        locationId: v.locationId,
        kind: "count",
        delta: v.counted - current,
        note: v.note,
      },
      current,
      p.unit,
    )
  })
  if (movement && movement.quantityMilli !== 0)
    await audit(
      ctx,
      "stock.counted",
      `Counted ${p.sku}: ${movement.quantityMilli > 0 ? "+" : ""}${formatQuantity(movement.quantityMilli, p.unit)}`,
      {
        target: { type: "product", id: p.id },
        metadata: { locationId: v.locationId, delta: movement.quantityMilli },
      },
    )
  await alertIfLow(ctx, p, before)
  return movement
}

// ---------- Reports ----------

function movementWhere(ctx: Pick<InventoryContext, "orgId">, f: MovementFilter) {
  const filter = movementFilterSchema.parse(f)
  const where: SQL[] = [eq(stockMovement.orgId, ctx.orgId)]
  if (filter.product) where.push(eq(stockMovement.productId, filter.product))
  if (filter.location) where.push(eq(stockMovement.locationId, filter.location))
  if (filter.kind) where.push(eq(stockMovement.kind, filter.kind))
  if (filter.from) where.push(gte(stockMovement.createdAt, new Date(`${filter.from}T00:00:00Z`)))
  if (filter.to) {
    const end = new Date(`${filter.to}T00:00:00Z`)
    end.setUTCDate(end.getUTCDate() + 1)
    where.push(lt(stockMovement.createdAt, end))
  }
  return { where: and(...where), filter }
}

const movementColumns = {
  id: stockMovement.id,
  createdAt: stockMovement.createdAt,
  kind: stockMovement.kind,
  quantityMilli: stockMovement.quantityMilli,
  balanceAfterMilli: stockMovement.balanceAfterMilli,
  reason: stockMovement.reason,
  reference: stockMovement.reference,
  note: stockMovement.note,
  productId: stockMovement.productId,
  sku: product.sku,
  productName: product.name,
  unit: product.unit,
  locationName: location.name,
  byName: user.name,
}

export async function listMovements(ctx: Pick<InventoryContext, "orgId">, f: MovementFilter = {}) {
  const { where, filter } = movementWhere(ctx, f)
  const [rows, [total]] = await Promise.all([
    db
      .select(movementColumns)
      .from(stockMovement)
      .innerJoin(product, eq(product.id, stockMovement.productId))
      .innerJoin(location, eq(location.id, stockMovement.locationId))
      .leftJoin(user, eq(user.id, stockMovement.createdBy))
      .where(where)
      .orderBy(desc(stockMovement.createdAt), desc(stockMovement.id))
      .limit(PAGE_SIZE)
      .offset((filter.page - 1) * PAGE_SIZE),
    db.select({ n: count() }).from(stockMovement).where(where),
  ])
  return { rows, total: total?.n ?? 0, page: filter.page, pageSize: PAGE_SIZE, filter }
}

const csvCell = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? "" : String(v)
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return `"${safe.replace(/"/g, '""')}"`
}

/** The ledger as CSV (formula-safe). Up to 10,000 rows. */
export async function movementsCsv(ctx: Pick<InventoryContext, "orgId">, f: MovementFilter = {}) {
  const { where } = movementWhere(ctx, f)
  const rows = await db
    .select(movementColumns)
    .from(stockMovement)
    .innerJoin(product, eq(product.id, stockMovement.productId))
    .innerJoin(location, eq(location.id, stockMovement.locationId))
    .leftJoin(user, eq(user.id, stockMovement.createdBy))
    .where(where)
    .orderBy(desc(stockMovement.createdAt))
    .limit(10_000)
  const head = [
    "date",
    "sku",
    "product",
    "location",
    "type",
    "quantity",
    "balance_after",
    "unit",
    "reason",
    "reference",
    "note",
    "by",
  ]
  return [
    head.map(csvCell).join(","),
    ...rows.map((r) =>
      [
        r.createdAt.toISOString(),
        r.sku,
        r.productName,
        r.locationName,
        KIND_LABELS[r.kind],
        r.quantityMilli / 1000,
        r.balanceAfterMilli / 1000,
        r.unit,
        r.reason,
        r.reference,
        r.note,
        r.byName,
      ]
        .map((c) => csvCell(c as string | number | null))
        .join(","),
    ),
  ].join("\n")
}

/** Headline numbers: active products, stock value at cost (per currency), low and out counts. */
export async function inventorySummary(ctx: Pick<InventoryContext, "orgId">) {
  const [value, counts] = await Promise.all([
    db
      .select({
        currency: product.currency,
        cents:
          sql<number>`coalesce(sum(round(${stockLevel.quantityMilli}::numeric * ${product.costCents} / 1000)), 0)::bigint`.mapWith(
            Number,
          ),
      })
      .from(stockLevel)
      .innerJoin(product, eq(product.id, stockLevel.productId))
      .where(and(eq(stockLevel.orgId, ctx.orgId), eq(product.status, "active")))
      .groupBy(product.currency),
    db
      .select({
        products: count(),
        out: sql<number>`count(*) filter (where coalesce(${onHand.qty}, 0) <= 0)::int`,
        low: sql<number>`count(*) filter (where ${product.reorderPointMilli} > 0 and coalesce(${onHand.qty}, 0) > 0 and coalesce(${onHand.qty}, 0) <= ${product.reorderPointMilli})::int`,
      })
      .from(product)
      .leftJoin(onHand, eq(onHand.productId, product.id))
      .where(and(eq(product.orgId, ctx.orgId), eq(product.status, "active"))),
  ])
  return {
    value: value.filter((v) => v.cents > 0),
    ...(counts[0] ?? { products: 0, out: 0, low: 0 }),
  }
}

/** Active products at or below their reorder point, for a purchase list. */
export async function reorderList(ctx: Pick<InventoryContext, "orgId">) {
  return db
    .select({
      id: product.id,
      sku: product.sku,
      name: product.name,
      unit: product.unit,
      onHandMilli: onHandQty,
      reorderPointMilli: product.reorderPointMilli,
      reorderQtyMilli: product.reorderQtyMilli,
    })
    .from(product)
    .leftJoin(onHand, eq(onHand.productId, product.id))
    .where(
      and(
        eq(product.orgId, ctx.orgId),
        eq(product.status, "active"),
        sql`${product.reorderPointMilli} > 0`,
        sql`coalesce(${onHand.qty}, 0) <= ${product.reorderPointMilli}`,
      ),
    )
    .orderBy(asc(product.name))
    .limit(1000)
}
