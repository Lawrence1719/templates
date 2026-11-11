import "server-only"

import { audit } from "@templates/audit"
import { db } from "@templates/db"
import {
  type Customer,
  crmActivity,
  customer,
  customerContact,
  type Deal,
  deal,
  member,
  user,
} from "@templates/db/schema"
import { membersWithRole, notify } from "@templates/notifications"
import {
  and,
  arrayContains,
  asc,
  count,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  isNull,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { z } from "zod"

import {
  type ActivityInput,
  activityInputSchema,
  type ContactInput,
  type CustomerFilter,
  type CustomerInput,
  contactInputSchema,
  customerFilterSchema,
  customerInputSchema,
  type DealInput,
  type DealStage,
  dealInputSchema,
  fieldErrors,
  formatMoney,
  OPEN_STAGES,
  STAGE_LABELS,
  STATUS_LABELS,
} from "./definitions"

export type CrmContext = { orgId: string; user: { id: string; name: string; email: string } }

export class CrmError extends Error {
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
const notFound = () => new CrmError("Not found", 404)

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input)
  if (!r.success)
    throw new CrmError("Please fix the highlighted fields.", 400, fieldErrors(r.error))
  return r.data
}

/** Escapes LIKE wildcards so a search for "50%" means the text "50%". */
const likeTerm = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

// ---------- Ownership checks: every lookup is scoped to ctx.orgId ----------

async function ownCustomer(ctx: Pick<CrmContext, "orgId">, id: string) {
  if (!isUuid(id)) throw notFound()
  const [row] = await db
    .select()
    .from(customer)
    .where(and(eq(customer.id, id), eq(customer.orgId, ctx.orgId)))
  if (!row) throw notFound()
  return row
}

async function ownDeal(ctx: Pick<CrmContext, "orgId">, id: string) {
  if (!isUuid(id)) throw notFound()
  const [row] = await db
    .select()
    .from(deal)
    .where(and(eq(deal.id, id), eq(deal.orgId, ctx.orgId)))
  if (!row) throw notFound()
  return row
}

/** An owner must be a member of this org, or anyone could assign records to strangers. */
async function assertMember(ctx: Pick<CrmContext, "orgId">, userId: string | null) {
  if (!userId) return
  const [m] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, ctx.orgId), eq(member.userId, userId)))
  if (!m)
    throw new CrmError("Please fix the highlighted fields.", 400, {
      ownerId: "Choose someone in this organization",
    })
}

/** Members of the org, for owner pickers. */
export async function crmMembers(ctx: Pick<CrmContext, "orgId">) {
  return db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, ctx.orgId))
    .orderBy(asc(user.name))
}

function timeline(
  ctx: CrmContext,
  customerId: string,
  body: string,
  extra: { dealId?: string } = {},
) {
  return db.insert(crmActivity).values({
    orgId: ctx.orgId,
    customerId,
    dealId: extra.dealId ?? null,
    kind: "system",
    body,
    createdBy: ctx.user.id,
  })
}

async function notifyAssigned(
  ctx: CrmContext,
  ownerId: string | null,
  title: string,
  link: string,
) {
  if (!ownerId || ownerId === ctx.user.id) return
  await notify({
    orgId: ctx.orgId,
    to: [ownerId],
    type: "crm.assigned",
    title,
    body: `Assigned by ${ctx.user.name}.`,
    link,
  })
}

// ---------- Customers ----------

const ownerUser = alias(user, "owner_user")

function customerWhere(ctx: Pick<CrmContext, "orgId"> & { userId?: string }, f: CustomerFilter) {
  const filter = customerFilterSchema.parse(f)
  const where: SQL[] = [eq(customer.orgId, ctx.orgId)]
  if (filter.status) where.push(eq(customer.status, filter.status))
  if (filter.owner === "none") where.push(isNull(customer.ownerId))
  else if (filter.owner === "me" && ctx.userId) where.push(eq(customer.ownerId, ctx.userId))
  else if (filter.owner && filter.owner !== "me") where.push(eq(customer.ownerId, filter.owner))
  if (filter.tag) where.push(arrayContains(customer.tags, [filter.tag]))
  if (filter.q) {
    const term = likeTerm(filter.q)
    const search = or(
      ilike(customer.name, term),
      ilike(customer.email, term),
      ilike(customer.phone, term),
      // Also find a company by the people who work there.
      exists(
        db
          .select({ one: sql`1` })
          .from(customerContact)
          .where(
            and(
              eq(customerContact.customerId, customer.id),
              or(ilike(customerContact.name, term), ilike(customerContact.email, term)),
            ),
          ),
      ),
    )
    if (search) where.push(search)
  }
  return { where: and(...where), page: filter.page }
}

export async function listCustomers(
  ctx: Pick<CrmContext, "orgId"> & { userId?: string },
  f: CustomerFilter = {},
) {
  const { where, page } = customerWhere(ctx, f)
  const openDeals = db
    .select({ customerId: deal.customerId, n: count().as("n") })
    .from(deal)
    .where(and(eq(deal.orgId, ctx.orgId), inArray(deal.stage, [...OPEN_STAGES])))
    .groupBy(deal.customerId)
    .as("open_deals")

  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: customer.id,
        kind: customer.kind,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        status: customer.status,
        tags: customer.tags,
        updatedAt: customer.updatedAt,
        ownerId: customer.ownerId,
        ownerName: ownerUser.name,
        openDeals: sql<number>`coalesce(${openDeals.n}, 0)::int`,
      })
      .from(customer)
      .leftJoin(ownerUser, eq(ownerUser.id, customer.ownerId))
      .leftJoin(openDeals, eq(openDeals.customerId, customer.id))
      .where(where)
      .orderBy(desc(customer.updatedAt), desc(customer.id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ n: count() }).from(customer).where(where),
  ])
  return { rows, total: total?.n ?? 0, page, pageSize: PAGE_SIZE }
}

/** Tags in use, for the filter list. */
export async function customerTags(ctx: Pick<CrmContext, "orgId">) {
  const rows = await db.execute<{ tag: string }>(
    sql`select distinct unnest(${customer.tags}) as tag from ${customer} where ${customer.orgId} = ${ctx.orgId} order by tag limit 200`,
  )
  return rows.map((r) => r.tag)
}

export async function getCustomer(ctx: Pick<CrmContext, "orgId">, id: string) {
  const c = await ownCustomer(ctx, id)
  const author = alias(user, "author")
  const [owner, contacts, deals, activity] = await Promise.all([
    c.ownerId
      ? db
          .select({ id: user.id, name: user.name, email: user.email })
          .from(user)
          .where(eq(user.id, c.ownerId))
          .then((r) => r[0] ?? null)
      : null,
    db
      .select()
      .from(customerContact)
      .where(and(eq(customerContact.customerId, c.id), eq(customerContact.orgId, ctx.orgId)))
      .orderBy(desc(customerContact.isPrimary), asc(customerContact.name)),
    db
      .select({
        id: deal.id,
        title: deal.title,
        valueCents: deal.valueCents,
        currency: deal.currency,
        stage: deal.stage,
        expectedCloseOn: deal.expectedCloseOn,
        ownerId: deal.ownerId,
        ownerName: ownerUser.name,
      })
      .from(deal)
      .leftJoin(ownerUser, eq(ownerUser.id, deal.ownerId))
      .where(and(eq(deal.customerId, c.id), eq(deal.orgId, ctx.orgId)))
      .orderBy(desc(deal.createdAt)),
    db
      .select({
        id: crmActivity.id,
        kind: crmActivity.kind,
        body: crmActivity.body,
        occurredAt: crmActivity.occurredAt,
        createdBy: crmActivity.createdBy,
        authorName: author.name,
        dealId: crmActivity.dealId,
      })
      .from(crmActivity)
      .leftJoin(author, eq(author.id, crmActivity.createdBy))
      .where(and(eq(crmActivity.customerId, c.id), eq(crmActivity.orgId, ctx.orgId)))
      .orderBy(desc(crmActivity.occurredAt), desc(crmActivity.createdAt))
      .limit(200),
  ])
  return { customer: c, owner, contacts, deals, activity }
}

export async function createCustomer(ctx: CrmContext, input: CustomerInput) {
  const v = parse(customerInputSchema, input)
  await assertMember(ctx, v.ownerId)
  const [row] = await db
    .insert(customer)
    .values({ ...v, orgId: ctx.orgId, createdBy: ctx.user.id })
    .returning()
  if (!row) throw new Error("insert failed")
  await Promise.all([
    timeline(ctx, row.id, `${ctx.user.name} added ${row.name}`),
    audit(ctx, "customer.created", `Added customer ${row.name}`, {
      target: { type: "customer", id: row.id },
    }),
    notifyAssigned(ctx, row.ownerId, `You own ${row.name} now`, `/customers/${row.id}`),
  ])
  return row
}

const TRACKED: (keyof Customer)[] = [
  "kind",
  "name",
  "email",
  "phone",
  "website",
  "address",
  "status",
  "ownerId",
  "tags",
]

export async function updateCustomer(ctx: CrmContext, id: string, input: CustomerInput) {
  const before = await ownCustomer(ctx, id)
  const v = parse(customerInputSchema, input)
  if (v.ownerId !== before.ownerId) await assertMember(ctx, v.ownerId)
  const changed = TRACKED.filter(
    (k) => JSON.stringify(before[k]) !== JSON.stringify(v[k as keyof typeof v]),
  )
  if (!changed.length) return before
  const [row] = await db
    .update(customer)
    .set(v)
    .where(and(eq(customer.id, id), eq(customer.orgId, ctx.orgId)))
    .returning()
  if (!row) throw notFound()

  const work: Promise<unknown>[] = [
    audit(ctx, "customer.updated", `Updated customer ${row.name}`, {
      target: { type: "customer", id },
      metadata: { changed },
    }),
  ]
  if (changed.includes("status"))
    work.push(
      timeline(
        ctx,
        id,
        `${ctx.user.name} changed status from ${STATUS_LABELS[before.status]} to ${STATUS_LABELS[row.status]}`,
      ),
    )
  if (changed.includes("ownerId")) {
    const [owner] = row.ownerId
      ? await db.select({ name: user.name }).from(user).where(eq(user.id, row.ownerId))
      : []
    work.push(
      timeline(
        ctx,
        id,
        owner
          ? `${ctx.user.name} made ${owner.name} the owner`
          : `${ctx.user.name} removed the owner`,
      ),
      notifyAssigned(ctx, row.ownerId, `You own ${row.name} now`, `/customers/${id}`),
    )
  }
  await Promise.all(work)
  return row
}

/** Deletes the customer with its contacts, deals and timeline. Callers check `customer: ["delete"]`. */
export async function deleteCustomer(ctx: CrmContext, id: string) {
  const c = await ownCustomer(ctx, id)
  await db.delete(customer).where(and(eq(customer.id, id), eq(customer.orgId, ctx.orgId)))
  await audit(ctx, "customer.deleted", `Deleted customer ${c.name}`, {
    target: { type: "customer", id },
  })
}

// ---------- Contacts ----------

async function ownContact(ctx: Pick<CrmContext, "orgId">, id: string) {
  if (!isUuid(id)) throw notFound()
  const [row] = await db
    .select()
    .from(customerContact)
    .where(and(eq(customerContact.id, id), eq(customerContact.orgId, ctx.orgId)))
  if (!row) throw notFound()
  return row
}

export async function addContact(ctx: CrmContext, customerId: string, input: ContactInput) {
  const c = await ownCustomer(ctx, customerId)
  const v = parse(contactInputSchema, input)
  const row = await db.transaction(async (tx) => {
    // One primary contact per customer; the first contact is primary by default.
    const [existing] = await tx
      .select({ n: count() })
      .from(customerContact)
      .where(eq(customerContact.customerId, c.id))
    const isPrimary = v.isPrimary || (existing?.n ?? 0) === 0
    if (isPrimary)
      await tx
        .update(customerContact)
        .set({ isPrimary: false })
        .where(eq(customerContact.customerId, c.id))
    const [r] = await tx
      .insert(customerContact)
      .values({ ...v, isPrimary, orgId: ctx.orgId, customerId: c.id })
      .returning()
    return r
  })
  if (!row) throw new Error("insert failed")
  await audit(ctx, "contact.created", `Added ${row.name} to ${c.name}`, {
    target: { type: "customer", id: c.id },
  })
  return row
}

export async function updateContact(ctx: CrmContext, id: string, input: ContactInput) {
  const before = await ownContact(ctx, id)
  const v = parse(contactInputSchema, input)
  const row = await db.transaction(async (tx) => {
    if (v.isPrimary && !before.isPrimary)
      await tx
        .update(customerContact)
        .set({ isPrimary: false })
        .where(eq(customerContact.customerId, before.customerId))
    const [r] = await tx
      .update(customerContact)
      // Unticking primary on the only primary would leave none, so keep it.
      .set({ ...v, isPrimary: v.isPrimary || before.isPrimary })
      .where(and(eq(customerContact.id, id), eq(customerContact.orgId, ctx.orgId)))
      .returning()
    return r
  })
  await audit(ctx, "contact.updated", `Updated contact ${v.name}`, {
    target: { type: "customer", id: before.customerId },
  })
  return row
}

export async function deleteContact(ctx: CrmContext, id: string) {
  const c = await ownContact(ctx, id)
  await db.transaction(async (tx) => {
    await tx
      .delete(customerContact)
      .where(and(eq(customerContact.id, id), eq(customerContact.orgId, ctx.orgId)))
    if (c.isPrimary) {
      // Promote the next contact so there's still a primary.
      const [next] = await tx
        .select({ id: customerContact.id })
        .from(customerContact)
        .where(eq(customerContact.customerId, c.customerId))
        .orderBy(asc(customerContact.createdAt))
        .limit(1)
      if (next)
        await tx
          .update(customerContact)
          .set({ isPrimary: true })
          .where(eq(customerContact.id, next.id))
    }
  })
  await audit(ctx, "contact.deleted", `Removed contact ${c.name}`, {
    target: { type: "customer", id: c.customerId },
  })
}

// ---------- Activity ----------

export async function logActivity(
  ctx: CrmContext,
  customerId: string,
  input: ActivityInput & { dealId?: string | null },
) {
  const c = await ownCustomer(ctx, customerId)
  const v = parse(activityInputSchema, input)
  let dealId: string | null = null
  if (input.dealId) {
    const d = await ownDeal(ctx, input.dealId)
    if (d.customerId !== c.id) throw notFound()
    dealId = d.id
  }
  const [row] = await db
    .insert(crmActivity)
    .values({ ...v, orgId: ctx.orgId, customerId: c.id, dealId, createdBy: ctx.user.id })
    .returning()
  // Logging activity counts as touching the customer, so it rises in the list.
  await db.update(customer).set({ updatedAt: new Date() }).where(eq(customer.id, c.id))
  return row
}

/**
 * People can delete what they logged; `canDeleteAny` (admins) can delete anyone's.
 * System entries are history and can't be deleted.
 */
export async function deleteActivity(ctx: CrmContext, id: string, opts: { canDeleteAny: boolean }) {
  if (!isUuid(id)) throw notFound()
  const [a] = await db
    .select()
    .from(crmActivity)
    .where(and(eq(crmActivity.id, id), eq(crmActivity.orgId, ctx.orgId)))
  if (!a) throw notFound()
  if (a.kind === "system") throw new CrmError("Automatic entries can't be deleted.", 409)
  if (a.createdBy !== ctx.user.id && !opts.canDeleteAny)
    throw new CrmError("You can only delete entries you logged.", 403)
  await db.delete(crmActivity).where(and(eq(crmActivity.id, id), eq(crmActivity.orgId, ctx.orgId)))
  await audit(ctx, "activity.deleted", `Deleted a ${a.kind} from the timeline`, {
    target: { type: "customer", id: a.customerId },
  })
}

// ---------- Deals ----------

export async function listDeals(
  ctx: Pick<CrmContext, "orgId"> & { userId?: string },
  f: { owner?: "me"; customerId?: string } = {},
) {
  const where: SQL[] = [eq(deal.orgId, ctx.orgId)]
  if (f.owner === "me" && ctx.userId) where.push(eq(deal.ownerId, ctx.userId))
  if (f.customerId && isUuid(f.customerId)) where.push(eq(deal.customerId, f.customerId))
  return db
    .select({
      id: deal.id,
      title: deal.title,
      valueCents: deal.valueCents,
      currency: deal.currency,
      stage: deal.stage,
      expectedCloseOn: deal.expectedCloseOn,
      closedAt: deal.closedAt,
      updatedAt: deal.updatedAt,
      customerId: deal.customerId,
      customerName: customer.name,
      ownerId: deal.ownerId,
      ownerName: ownerUser.name,
    })
    .from(deal)
    .innerJoin(customer, eq(customer.id, deal.customerId))
    .leftJoin(ownerUser, eq(ownerUser.id, deal.ownerId))
    .where(and(...where))
    .orderBy(asc(deal.expectedCloseOn), desc(deal.updatedAt))
    .limit(1000)
}

export const getDeal = ownDeal

export async function createDeal(ctx: CrmContext, customerId: string, input: DealInput) {
  const c = await ownCustomer(ctx, customerId)
  const v = parse(dealInputSchema, input)
  await assertMember(ctx, v.ownerId)
  const closed = v.stage === "won" || v.stage === "lost"
  const { value, ...rest } = v
  const [row] = await db
    .insert(deal)
    .values({
      ...rest,
      valueCents: value,
      orgId: ctx.orgId,
      customerId: c.id,
      closedAt: closed ? new Date() : null,
      createdBy: ctx.user.id,
    })
    .returning()
  if (!row) throw new Error("insert failed")
  await Promise.all([
    timeline(
      ctx,
      c.id,
      `${ctx.user.name} opened deal "${row.title}" (${formatMoney(row.valueCents, row.currency)})`,
      { dealId: row.id },
    ),
    audit(ctx, "deal.created", `Opened deal ${row.title} for ${c.name}`, {
      target: { type: "deal", id: row.id },
    }),
    notifyAssigned(ctx, row.ownerId, `You own the deal ${row.title}`, `/customers/${c.id}`),
  ])
  return row
}

export async function updateDeal(ctx: CrmContext, id: string, input: DealInput) {
  const before = await ownDeal(ctx, id)
  const v = parse(dealInputSchema, input)
  if (v.ownerId !== before.ownerId) await assertMember(ctx, v.ownerId)
  const { value, ...rest } = v
  const [row] = await db
    .update(deal)
    .set({ ...rest, valueCents: value, closedAt: closedAtFor(before, v.stage) })
    .where(and(eq(deal.id, id), eq(deal.orgId, ctx.orgId)))
    .returning()
  if (!row) throw notFound()
  await Promise.all([
    audit(ctx, "deal.updated", `Updated deal ${row.title}`, { target: { type: "deal", id } }),
    before.stage !== row.stage ? afterStageChange(ctx, before, row) : null,
    v.ownerId !== before.ownerId
      ? notifyAssigned(
          ctx,
          row.ownerId,
          `You own the deal ${row.title}`,
          `/customers/${row.customerId}`,
        )
      : null,
  ])
  return row
}

/** Moves a deal to another pipeline stage (the board's main action). */
export async function moveDeal(ctx: CrmContext, id: string, stage: DealStage) {
  const before = await ownDeal(ctx, id)
  if (before.stage === stage) return before
  const [row] = await db
    .update(deal)
    .set({ stage, closedAt: closedAtFor(before, stage) })
    .where(and(eq(deal.id, id), eq(deal.orgId, ctx.orgId)))
    .returning()
  if (!row) throw notFound()
  await afterStageChange(ctx, before, row)
  return row
}

function closedAtFor(before: Deal, stage: DealStage) {
  const closed = stage === "won" || stage === "lost"
  if (!closed) return null
  const wasClosed = before.stage === "won" || before.stage === "lost"
  return wasClosed && before.closedAt ? before.closedAt : new Date()
}

async function afterStageChange(ctx: CrmContext, before: Deal, after: Deal) {
  const from = STAGE_LABELS[before.stage]
  const to = STAGE_LABELS[after.stage]
  const work: Promise<unknown>[] = [
    timeline(
      ctx,
      after.customerId,
      `${ctx.user.name} moved "${after.title}" from ${from} to ${to}`,
      {
        dealId: after.id,
      },
    ),
    audit(ctx, "deal.stage_changed", `Moved deal ${after.title} from ${from} to ${to}`, {
      target: { type: "deal", id: after.id },
      metadata: { from: before.stage, to: after.stage },
    }),
  ]
  if (after.stage === "won") {
    const leads = await membersWithRole(ctx.orgId, ["owner", "admin"])
    work.push(
      notify({
        orgId: ctx.orgId,
        to: [...leads, ...(after.ownerId ? [after.ownerId] : [])].filter((u) => u !== ctx.user.id),
        type: "deal.won",
        title: `Won: ${after.title} (${formatMoney(after.valueCents, after.currency)})`,
        body: `Closed by ${ctx.user.name}.`,
        link: `/customers/${after.customerId}`,
      }),
    )
  }
  await Promise.all(work)
}

/** Callers check `deal: ["delete"]`. */
export async function deleteDeal(ctx: CrmContext, id: string) {
  const d = await ownDeal(ctx, id)
  await db.delete(deal).where(and(eq(deal.id, id), eq(deal.orgId, ctx.orgId)))
  await Promise.all([
    timeline(ctx, d.customerId, `${ctx.user.name} deleted deal "${d.title}"`),
    audit(ctx, "deal.deleted", `Deleted deal ${d.title}`, { target: { type: "deal", id } }),
  ])
}

/** Open pipeline per stage, per currency (amounts in different currencies aren't added up). */
export async function pipelineSummary(ctx: Pick<CrmContext, "orgId">) {
  return db
    .select({
      stage: deal.stage,
      currency: deal.currency,
      deals: count(),
      valueCents: sql<number>`coalesce(sum(${deal.valueCents}), 0)::bigint`.mapWith(Number),
    })
    .from(deal)
    .where(and(eq(deal.orgId, ctx.orgId), ne(deal.stage, "lost")))
    .groupBy(deal.stage, deal.currency)
}

// ---------- Export ----------

/** CSV of customers matching a filter. Cells starting with = + - @ are neutralized for spreadsheets. */
export async function customersCsv(
  ctx: Pick<CrmContext, "orgId"> & { userId?: string },
  f: CustomerFilter = {},
) {
  const { where } = customerWhere(ctx, f)
  const rows = await db
    .select({
      name: customer.name,
      kind: customer.kind,
      status: customer.status,
      email: customer.email,
      phone: customer.phone,
      website: customer.website,
      address: customer.address,
      tags: customer.tags,
      owner: ownerUser.email,
      createdAt: customer.createdAt,
    })
    .from(customer)
    .leftJoin(ownerUser, eq(ownerUser.id, customer.ownerId))
    .where(where)
    .orderBy(asc(customer.name))
    .limit(10_000)
  const cell = (v: string | null) => {
    const s = v ?? ""
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
    return `"${safe.replace(/"/g, '""')}"`
  }
  const head = [
    "name",
    "type",
    "status",
    "email",
    "phone",
    "website",
    "address",
    "tags",
    "owner",
    "created_at",
  ]
  const lines = rows.map((r) =>
    [
      r.name,
      r.kind,
      r.status,
      r.email,
      r.phone,
      r.website,
      r.address,
      r.tags.join("; "),
      r.owner,
      r.createdAt.toISOString(),
    ]
      .map(cell)
      .join(","),
  )
  return [head.map(cell).join(","), ...lines].join("\n")
}
