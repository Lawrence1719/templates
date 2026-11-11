import "server-only"

import { randomInt } from "node:crypto"

import { audit } from "@templates/audit"
import { db } from "@templates/db"
import {
  customer,
  type Membership,
  member,
  membership,
  membershipCheckIn,
  membershipEvent,
  membershipPeriod,
  membershipPlan,
  membershipSettings,
  organization,
  user,
} from "@templates/db/schema"
import {
  createDraft as createInvoiceDraft,
  deleteDraft as deleteInvoiceDraft,
  getSettings as getInvoiceSettings,
} from "@templates/invoicing"
import { appUrl, renderEmail, sendEmail } from "@templates/notifications"
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  isNull,
  lt,
  lte,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm"
import { z } from "zod"

import {
  addDays,
  daysBetween,
  fieldErrors,
  formatMoney,
  type MembershipFilter,
  membershipFilterSchema,
  membershipState,
  nextPeriodStart,
  normalizeCardCode,
  type PaidVia,
  type PlanInput,
  periodEndFor,
  planInputSchema,
  type RenewInput,
  reasonSchema,
  renewInputSchema,
  type SettingsInput,
  type StartInput,
  settingsInputSchema,
  startInputSchema,
  today,
} from "./definitions"

export type MembershipContext = { orgId: string; user: { id: string; name: string; email: string } }

export class MembershipError extends Error {
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
type Org = Pick<MembershipContext, "orgId">

const isUuid = (s: string) => z.uuid().safeParse(s).success
const notFound = () => new MembershipError("Not found", 404)
const conflict = (m: string) => new MembershipError(m, 409)
const invalid = (fe: Record<string, string>) =>
  new MembershipError("Please fix the highlighted fields.", 400, fe)

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

// No 0/O or 1/I, so codes read back clearly. 24 characters ≈ 119 bits.
const CARD_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
function newCardToken() {
  let s = ""
  for (let i = 0; i < 24; i++) s += CARD_ALPHABET[randomInt(CARD_ALPHABET.length)]
  return s
}

const longDay = (d: string) =>
  new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${d}T00:00:00Z`),
  )

// ---------- Settings ----------

export async function getMembershipSettings(ctx: Org) {
  await db.insert(membershipSettings).values({ orgId: ctx.orgId }).onConflictDoNothing()
  const [s] = await db
    .select()
    .from(membershipSettings)
    .where(eq(membershipSettings.orgId, ctx.orgId))
  if (!s) throw new Error("membership settings missing")
  return s
}

export async function updateMembershipSettings(ctx: MembershipContext, input: SettingsInput) {
  const v = parse(settingsInputSchema, input)
  await getMembershipSettings(ctx)
  await db.update(membershipSettings).set(v).where(eq(membershipSettings.orgId, ctx.orgId))
  await audit(ctx, "membership_settings.updated", "Updated membership settings", { metadata: v })
}

// ---------- Plans ----------

export async function listPlans(ctx: Org, opts: { includeArchived?: boolean } = {}) {
  return db
    .select({
      id: membershipPlan.id,
      name: membershipPlan.name,
      description: membershipPlan.description,
      priceCents: membershipPlan.priceCents,
      currency: membershipPlan.currency,
      periodUnit: membershipPlan.periodUnit,
      periodCount: membershipPlan.periodCount,
      visitLimit: membershipPlan.visitLimit,
      status: membershipPlan.status,
      members:
        sql<number>`count(${membership.id}) filter (where ${membership.status} <> 'cancelled')::int`.mapWith(
          Number,
        ),
    })
    .from(membershipPlan)
    .leftJoin(membership, eq(membership.planId, membershipPlan.id))
    .where(
      and(
        eq(membershipPlan.orgId, ctx.orgId),
        opts.includeArchived ? undefined : eq(membershipPlan.status, "active"),
      ),
    )
    .groupBy(membershipPlan.id)
    .orderBy(asc(membershipPlan.status), asc(membershipPlan.priceCents))
}

export async function savePlan(ctx: MembershipContext, id: string | null, input: PlanInput) {
  const v = parse(planInputSchema, input)
  const values = {
    name: v.name,
    description: v.description,
    priceCents: v.price,
    currency: v.currency,
    periodUnit: v.periodUnit,
    periodCount: v.periodCount,
    visitLimit: v.visitLimit,
  }
  try {
    if (id) {
      if (!isUuid(id)) throw notFound()
      // Price and length changes apply from each member's next renewal.
      const [row] = await db
        .update(membershipPlan)
        .set(values)
        .where(and(eq(membershipPlan.id, id), eq(membershipPlan.orgId, ctx.orgId)))
        .returning()
      if (!row) throw notFound()
      await audit(ctx, "membership_plan.updated", `Updated plan ${v.name}`, { metadata: values })
      return row
    }
    const [row] = await db
      .insert(membershipPlan)
      .values({ orgId: ctx.orgId, ...values })
      .returning()
    if (!row) throw new Error("insert failed")
    await audit(ctx, "membership_plan.created", `Added plan ${v.name}`, { metadata: values })
    return row
  } catch (e) {
    if (pgCode(e) === "23505") throw invalid({ name: "You already have a plan with this name" })
    throw e
  }
}

export async function setPlanStatus(
  ctx: MembershipContext,
  id: string,
  status: "active" | "archived",
) {
  if (!isUuid(id)) throw notFound()
  const [row] = await db
    .update(membershipPlan)
    .set({ status })
    .where(and(eq(membershipPlan.id, id), eq(membershipPlan.orgId, ctx.orgId)))
    .returning()
  if (!row) throw notFound()
  await audit(
    ctx,
    `membership_plan.${status === "archived" ? "archived" : "restored"}`,
    `${status === "archived" ? "Archived" : "Restored"} plan ${row.name}`,
  )
}

// ---------- Memberships ----------

async function ownMembership(ctx: Org, id: string, t: Tx | typeof db = db) {
  if (!isUuid(id)) throw notFound()
  const [m] = await t
    .select()
    .from(membership)
    .where(and(eq(membership.id, id), eq(membership.orgId, ctx.orgId)))
  if (!m) throw notFound()
  return m
}

async function lockMembership(tx: Tx, ctx: Org, id: string) {
  const [m] = await tx
    .select()
    .from(membership)
    .where(and(eq(membership.id, id), eq(membership.orgId, ctx.orgId)))
    .for("update")
  if (!m) throw notFound()
  return m
}

function event(
  t: Tx | typeof db,
  ctx: MembershipContext,
  membershipId: string,
  kind: (typeof membershipEvent.$inferInsert)["kind"],
  body: string,
) {
  return t
    .insert(membershipEvent)
    .values({ orgId: ctx.orgId, membershipId, kind, body, createdBy: ctx.user.id })
}

async function planOf(ctx: Org, planId: string) {
  const [p] = await db
    .select()
    .from(membershipPlan)
    .where(and(eq(membershipPlan.id, planId), eq(membershipPlan.orgId, ctx.orgId)))
  return p ?? null
}

/** A draft invoice for one period, for "send an invoice" payments. Staff send it from Invoicing. */
async function periodInvoice(
  ctx: MembershipContext,
  customerId: string,
  plan: { name: string; priceCents: number; currency: string },
  start: string,
  end: string,
) {
  const settings = await getInvoiceSettings(ctx)
  const issue = today()
  return createInvoiceDraft(ctx, "invoice", {
    customerId,
    issueDate: issue,
    dueOn: addDays(issue, settings.defaultDueDays),
    currency: plan.currency as never,
    notes: `Membership: ${plan.name}`,
    lines: [
      {
        description: `${plan.name}, ${start} to ${end}`,
        quantity: "1",
        unitPrice: (plan.priceCents / 100).toFixed(2),
        taxRate: "0",
      },
    ],
  })
}

/** Signs a customer up. Payment is recorded with the first period; "invoice" makes a draft invoice. */
export async function startMembership(ctx: MembershipContext, input: StartInput) {
  const v = parse(startInputSchema, input)
  const settings = await getMembershipSettings(ctx)
  const t = today(settings.timeZone)
  const errors: Record<string, string> = {}
  const [[c], plan] = await Promise.all([
    db
      .select({ id: customer.id, name: customer.name, email: customer.email })
      .from(customer)
      .where(and(eq(customer.id, v.customerId), eq(customer.orgId, ctx.orgId))),
    planOf(ctx, v.planId),
  ])
  if (!c) errors.customerId = "Choose a customer from the list"
  if (!plan) errors.planId = "Choose a plan from the list"
  else if (plan.status !== "active") errors.planId = "That plan is no longer offered"
  if (v.startDay < addDays(t, -31)) errors.startDay = "Can't start more than a month ago"
  if (v.startDay > addDays(t, 365)) errors.startDay = "Can't start more than a year ahead"
  if (Object.keys(errors).length || !c || !plan) throw invalid(errors)

  const end = periodEndFor(v.startDay, plan)
  const inv = v.paidVia === "invoice" ? await periodInvoice(ctx, c.id, plan, v.startDay, end) : null
  try {
    const row = await db.transaction(async (tx) => {
      const [m] = await tx
        .insert(membership)
        .values({
          orgId: ctx.orgId,
          customerId: c.id,
          planId: plan.id,
          startedOn: v.startDay,
          periodStart: v.startDay,
          periodEnd: end,
          autoRenew: v.autoRenew,
          cardToken: newCardToken(),
          createdBy: ctx.user.id,
        })
        .returning()
      if (!m) throw new Error("insert failed")
      await tx.insert(membershipPeriod).values({
        orgId: ctx.orgId,
        membershipId: m.id,
        startDay: v.startDay,
        endDay: end,
        priceCents: plan.priceCents,
        currency: plan.currency,
        paidVia: v.paidVia,
        invoiceId: inv?.id ?? null,
        createdBy: ctx.user.id,
      })
      await event(
        tx,
        ctx,
        m.id,
        "started",
        `${ctx.user.name} started ${plan.name} (${v.paidVia === "free" ? "free" : formatMoney(plan.priceCents, plan.currency)}), until ${longDay(end)}`,
      )
      return m
    })
    await emailMember(ctx, row, "welcome")
    return row
  } catch (e) {
    // Don't leave an orphan draft invoice behind if the membership wasn't saved.
    if (inv) await deleteInvoiceDraft(ctx, inv.id).catch(() => {})
    throw e
  }
}

/**
 * Adds the next period. It starts the day after the current one ends, or
 * today if it already lapsed. `expectedPeriodEnd` must match, so a double
 * click or two people at once can't renew twice.
 */
export async function renewMembership(ctx: MembershipContext, id: string, input: RenewInput) {
  const pre = await ownMembership(ctx, id)
  const v = parse(renewInputSchema, input)
  if (pre.status !== "active")
    throw conflict(
      pre.status === "paused"
        ? "Resume the membership before renewing it."
        : "This membership is cancelled.",
    )
  if (pre.periodEnd !== v.expectedPeriodEnd)
    throw conflict("This membership was already renewed. Reload to see it.")
  const plan = await planOf(ctx, pre.planId)
  if (!plan) throw notFound()
  const settings = await getMembershipSettings(ctx)
  const start = nextPeriodStart(pre.periodEnd, today(settings.timeZone))
  const end = periodEndFor(start, plan)
  const inv =
    v.paidVia === "invoice" ? await periodInvoice(ctx, pre.customerId, plan, start, end) : null
  try {
    return await db.transaction(async (tx) => {
      const m = await lockMembership(tx, ctx, id)
      if (m.status !== "active") throw conflict("This membership can't be renewed now.")
      if (m.periodEnd !== v.expectedPeriodEnd)
        throw conflict("This membership was already renewed. Reload to see it.")
      const [row] = await tx
        .update(membership)
        .set({ periodStart: start, periodEnd: end, remindedFor: null })
        .where(eq(membership.id, id))
        .returning()
      await tx.insert(membershipPeriod).values({
        orgId: ctx.orgId,
        membershipId: id,
        startDay: start,
        endDay: end,
        priceCents: plan.priceCents,
        currency: plan.currency,
        paidVia: v.paidVia,
        invoiceId: inv?.id ?? null,
        createdBy: ctx.user.id,
      })
      await event(
        tx,
        ctx,
        id,
        "renewed",
        `${ctx.user.name} renewed ${plan.name} (${v.paidVia === "free" ? "free" : formatMoney(plan.priceCents, plan.currency)}): ${longDay(start)} to ${longDay(end)}`,
      )
      return row as Membership
    })
  } catch (e) {
    if (inv) await deleteInvoiceDraft(ctx, inv.id).catch(() => {})
    throw e
  }
}

/** Freezes a membership. The days it's paused are added back when it resumes. */
export async function pauseMembership(ctx: MembershipContext, id: string) {
  await ownMembership(ctx, id)
  const settings = await getMembershipSettings(ctx)
  const t = today(settings.timeZone)
  return db.transaction(async (tx) => {
    const m = await lockMembership(tx, ctx, id)
    if (m.status !== "active") throw conflict(`This membership is ${m.status}.`)
    if (m.periodEnd < t) throw conflict("This membership has expired. Renew it instead.")
    const [row] = await tx
      .update(membership)
      .set({ status: "paused", pausedOn: t })
      .where(eq(membership.id, id))
      .returning()
    await event(tx, ctx, id, "paused", `${ctx.user.name} paused the membership`)
    return row as Membership
  })
}

export async function resumeMembership(ctx: MembershipContext, id: string) {
  await ownMembership(ctx, id)
  const settings = await getMembershipSettings(ctx)
  const t = today(settings.timeZone)
  return db.transaction(async (tx) => {
    const m = await lockMembership(tx, ctx, id)
    if (m.status !== "paused" || !m.pausedOn) throw conflict("This membership isn't paused.")
    const days = Math.max(0, daysBetween(m.pausedOn, t))
    const end = addDays(m.periodEnd, days)
    const [row] = await tx
      .update(membership)
      .set({ status: "active", pausedOn: null, periodEnd: end, remindedFor: null })
      .where(eq(membership.id, id))
      .returning()
    await event(
      tx,
      ctx,
      id,
      "resumed",
      days
        ? `${ctx.user.name} resumed it after ${days} ${days === 1 ? "day" : "days"}; it now runs to ${longDay(end)}`
        : `${ctx.user.name} resumed it`,
    )
    return row as Membership
  })
}

export async function cancelMembership(ctx: MembershipContext, id: string, reason: string) {
  await ownMembership(ctx, id)
  const r = reasonSchema.safeParse(reason)
  if (!r.success) throw invalid({ reason: r.error.issues[0]?.message ?? "Invalid" })
  const row = await db.transaction(async (tx) => {
    const m = await lockMembership(tx, ctx, id)
    if (m.status === "cancelled") throw conflict("Already cancelled.")
    const [row] = await tx
      .update(membership)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        cancelReason: r.data,
        autoRenew: false,
        pausedOn: null,
      })
      .where(eq(membership.id, id))
      .returning()
    await event(tx, ctx, id, "cancelled", `${ctx.user.name} cancelled it: ${r.data}`)
    return row as Membership
  })
  await audit(ctx, "membership.cancelled", `Cancelled a membership: ${r.data}`, {
    target: { type: "membership", id },
  })
  return row
}

export async function setAutoRenew(ctx: MembershipContext, id: string, on: boolean) {
  const m = await ownMembership(ctx, id)
  if (m.status === "cancelled") throw conflict("This membership is cancelled.")
  await db.update(membership).set({ autoRenew: on }).where(eq(membership.id, id))
  await event(db, ctx, id, "note", `${ctx.user.name} turned automatic renewal ${on ? "on" : "off"}`)
}

/** A lost card: the old code stops working at once. */
export async function replaceCard(ctx: MembershipContext, id: string) {
  const m = await ownMembership(ctx, id)
  if (m.status === "cancelled") throw conflict("This membership is cancelled.")
  const [row] = await db
    .update(membership)
    .set({ cardToken: newCardToken() })
    .where(eq(membership.id, id))
    .returning()
  await event(
    db,
    ctx,
    id,
    "card_replaced",
    `${ctx.user.name} replaced the card; the old code no longer works`,
  )
  await audit(ctx, "membership.card_replaced", "Replaced a membership card", {
    target: { type: "membership", id },
  })
  return row as Membership
}

export async function emailCard(ctx: MembershipContext, id: string) {
  const m = await ownMembership(ctx, id)
  return emailMember(ctx, m, "card")
}

async function emailMember(ctx: Org, m: Membership, why: "welcome" | "card" | "reminder") {
  const [[c], [org], plan] = await Promise.all([
    db
      .select({ name: customer.name, email: customer.email })
      .from(customer)
      .where(eq(customer.id, m.customerId)),
    db.select({ name: organization.name }).from(organization).where(eq(organization.id, ctx.orgId)),
    planOf(ctx, m.planId),
  ])
  if (!c?.email || !plan) return false
  const from = org?.name ?? "Us"
  const subject =
    why === "reminder"
      ? m.autoRenew
        ? `Your ${plan.name} renews on ${longDay(addDays(m.periodEnd, 1))}`
        : `Your ${plan.name} ends on ${longDay(m.periodEnd)}`
      : why === "welcome"
        ? `Welcome to ${from}`
        : `Your ${from} membership card`
  try {
    await sendEmail({
      to: c.email,
      ...renderEmail({
        subject,
        heading: subject,
        paragraphs: [
          `Hi ${c.name},`,
          why === "reminder"
            ? m.autoRenew
              ? "We'll renew it automatically and send you the invoice."
              : "Renew at the front desk to keep coming in."
            : `Your ${plan.name} runs until ${longDay(m.periodEnd)}. Show your card at the desk when you arrive.`,
        ],
        action: { label: "Open my card", url: appUrl(`/m/${m.cardToken}`) },
        footer: `Sent by ${from}. Keep this link private: it works like your card.`,
      }),
    })
    return true
  } catch (e) {
    console.error("[memberships] email failed", e)
    return false
  }
}

// ---------- Check-ins ----------

export type CheckInResult =
  | {
      ok: true
      checkInId: string
      membershipId: string
      memberName: string
      planName: string
      periodEnd: string
      visitsLeft: number | null
    }
  | { ok: false; reason: string; membershipId?: string; memberName?: string }

/**
 * Lets a member in, by card code (scanned or typed) or picked at the desk.
 * Refuses paused, cancelled, expired and not-yet-started memberships, a second
 * scan within the cooldown, and visits past the plan's limit. Runs under a
 * row lock so two scans at once count once.
 */
export async function checkIn(
  ctx: MembershipContext,
  by: { code: string } | { membershipId: string },
): Promise<CheckInResult> {
  const settings = await getMembershipSettings(ctx)
  const t = today(settings.timeZone)
  let id: string | null = null
  if ("code" in by) {
    const code = normalizeCardCode(by.code)
    if (!/^[A-Z0-9]{20,40}$/.test(code))
      return { ok: false, reason: "That doesn't look like a card code." }
    const [m] = await db
      .select({ id: membership.id })
      .from(membership)
      .where(and(eq(membership.orgId, ctx.orgId), eq(membership.cardToken, code)))
    if (!m)
      return { ok: false, reason: "No membership has that card code. It may have been replaced." }
    id = m.id
  } else {
    if (!isUuid(by.membershipId)) throw notFound()
    id = by.membershipId
  }
  return db.transaction(async (tx) => {
    const m = await lockMembership(tx, ctx, id as string)
    const [[c], [plan]] = await Promise.all([
      tx.select({ name: customer.name }).from(customer).where(eq(customer.id, m.customerId)),
      tx.select().from(membershipPlan).where(eq(membershipPlan.id, m.planId)),
    ])
    const who = { membershipId: m.id, memberName: c?.name ?? "Member" }
    if (m.status === "cancelled")
      return { ok: false as const, ...who, reason: "This membership is cancelled." }
    if (m.status === "paused")
      return {
        ok: false as const,
        ...who,
        reason: `Paused since ${longDay(m.pausedOn ?? t)}. Resume it first.`,
      }
    if (m.periodStart > t)
      return { ok: false as const, ...who, reason: `It starts on ${longDay(m.periodStart)}.` }
    if (m.periodEnd < t)
      return {
        ok: false as const,
        ...who,
        reason: `Expired on ${longDay(m.periodEnd)}. Renew it first.`,
      }

    const live = and(eq(membershipCheckIn.membershipId, m.id), isNull(membershipCheckIn.voidedAt))
    const [[last], [used]] = await Promise.all([
      tx
        .select({ at: membershipCheckIn.checkedInAt })
        .from(membershipCheckIn)
        .where(live)
        .orderBy(desc(membershipCheckIn.checkedInAt))
        .limit(1),
      tx
        .select({ n: count() })
        .from(membershipCheckIn)
        .where(and(live, eq(membershipCheckIn.periodStart, m.periodStart))),
    ])
    if (last && settings.checkInCooldownMinutes > 0) {
      const mins = (Date.now() - last.at.getTime()) / 60_000
      if (mins < settings.checkInCooldownMinutes) {
        const at = new Intl.DateTimeFormat("en", {
          hour: "numeric",
          minute: "2-digit",
          timeZone: settings.timeZone,
        }).format(last.at)
        return { ok: false as const, ...who, reason: `Already checked in at ${at}.` }
      }
    }
    const usedN = used?.n ?? 0
    if (plan?.visitLimit && usedN >= plan.visitLimit)
      return {
        ok: false as const,
        ...who,
        reason: `No visits left this period (${usedN} of ${plan.visitLimit} used). Renew to add more.`,
      }
    const [row] = await tx
      .insert(membershipCheckIn)
      .values({
        orgId: ctx.orgId,
        membershipId: m.id,
        periodStart: m.periodStart,
        method: "code" in by ? "card" : "desk",
        checkedInBy: ctx.user.id,
      })
      .returning()
    if (!row) throw new Error("insert failed")
    return {
      ok: true as const,
      checkInId: row.id,
      membershipId: m.id,
      memberName: who.memberName,
      planName: plan?.name ?? "",
      periodEnd: m.periodEnd,
      visitsLeft: plan?.visitLimit ? plan.visitLimit - usedN - 1 : null,
    }
  })
}

/** Undoes a check-in made by mistake. Staff can undo their own for 15 minutes; managers any time. */
export async function voidCheckIn(
  ctx: MembershipContext,
  id: string,
  opts: { asManager?: boolean } = {},
) {
  if (!isUuid(id)) throw notFound()
  const [c] = await db
    .select()
    .from(membershipCheckIn)
    .where(and(eq(membershipCheckIn.id, id), eq(membershipCheckIn.orgId, ctx.orgId)))
  if (!c) throw notFound()
  if (c.voidedAt) throw conflict("Already undone.")
  if (
    !opts.asManager &&
    (c.checkedInBy !== ctx.user.id || Date.now() - c.checkedInAt.getTime() > 15 * 60_000)
  )
    throw new MembershipError("Only a manager can undo this check-in now.", 403)
  const [row] = await db
    .update(membershipCheckIn)
    .set({ voidedAt: new Date(), voidedBy: ctx.user.id })
    .where(and(eq(membershipCheckIn.id, id), isNull(membershipCheckIn.voidedAt)))
    .returning()
  if (!row) throw conflict("Already undone.")
  await audit(ctx, "membership.check_in_voided", "Undid a check-in", {
    target: { type: "membership", id: c.membershipId },
  })
}

/** Today's visits in the org's time zone, newest first. */
export async function todaysCheckIns(ctx: Org) {
  const settings = await getMembershipSettings(ctx)
  const t = today(settings.timeZone)
  const tz = settings.timeZone
  return db
    .select({
      id: membershipCheckIn.id,
      at: membershipCheckIn.checkedInAt,
      method: membershipCheckIn.method,
      voidedAt: membershipCheckIn.voidedAt,
      checkedInBy: membershipCheckIn.checkedInBy,
      byName: user.name,
      membershipId: membership.id,
      memberName: customer.name,
      planName: membershipPlan.name,
    })
    .from(membershipCheckIn)
    .innerJoin(membership, eq(membership.id, membershipCheckIn.membershipId))
    .innerJoin(customer, eq(customer.id, membership.customerId))
    .innerJoin(membershipPlan, eq(membershipPlan.id, membership.planId))
    .leftJoin(user, eq(user.id, membershipCheckIn.checkedInBy))
    .where(
      and(
        eq(membershipCheckIn.orgId, ctx.orgId),
        sql`${membershipCheckIn.checkedInAt} >= ((${t})::date)::timestamp at time zone ${tz}`,
        sql`${membershipCheckIn.checkedInAt} < ((${t})::date + 1)::timestamp at time zone ${tz}`,
      ),
    )
    .orderBy(desc(membershipCheckIn.checkedInAt))
    .limit(500)
}

// ---------- Reading ----------

export async function getMembership(ctx: Org, id: string) {
  const m = await ownMembership(ctx, id)
  const settings = await getMembershipSettings(ctx)
  const t = today(settings.timeZone)
  const [c, plan, periods, checkIns, events, [used]] = await Promise.all([
    db
      .select({
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
      })
      .from(customer)
      .where(eq(customer.id, m.customerId))
      .then((r) => r[0] ?? null),
    planOf(ctx, m.planId),
    db
      .select()
      .from(membershipPeriod)
      .where(and(eq(membershipPeriod.membershipId, id), eq(membershipPeriod.orgId, ctx.orgId)))
      .orderBy(desc(membershipPeriod.startDay)),
    db
      .select({
        id: membershipCheckIn.id,
        at: membershipCheckIn.checkedInAt,
        method: membershipCheckIn.method,
        voidedAt: membershipCheckIn.voidedAt,
        byName: user.name,
      })
      .from(membershipCheckIn)
      .leftJoin(user, eq(user.id, membershipCheckIn.checkedInBy))
      .where(and(eq(membershipCheckIn.membershipId, id), eq(membershipCheckIn.orgId, ctx.orgId)))
      .orderBy(desc(membershipCheckIn.checkedInAt))
      .limit(50),
    db
      .select({
        id: membershipEvent.id,
        kind: membershipEvent.kind,
        body: membershipEvent.body,
        createdAt: membershipEvent.createdAt,
      })
      .from(membershipEvent)
      .where(and(eq(membershipEvent.membershipId, id), eq(membershipEvent.orgId, ctx.orgId)))
      .orderBy(desc(membershipEvent.createdAt))
      .limit(100),
    db
      .select({ n: count() })
      .from(membershipCheckIn)
      .where(
        and(
          eq(membershipCheckIn.membershipId, id),
          eq(membershipCheckIn.periodStart, m.periodStart),
          isNull(membershipCheckIn.voidedAt),
        ),
      ),
  ])
  const visitsUsed = used?.n ?? 0
  return {
    membership: m,
    customer: c,
    plan,
    periods,
    checkIns,
    events,
    state: membershipState(m, t, settings.reminderDays || 7),
    today: t,
    timeZone: settings.timeZone,
    visitsUsed,
    visitsLeft: plan?.visitLimit ? Math.max(0, plan.visitLimit - visitsUsed) : null,
  }
}

function stateWhere(state: string | undefined, t: string, soon: string): SQL | undefined {
  const active = eq(membership.status, "active")
  switch (state) {
    case "active":
      return and(active, lte(membership.periodStart, t), gte(membership.periodEnd, t))
    case "expiring":
      return and(active, gte(membership.periodEnd, t), lte(membership.periodEnd, soon))
    case "expired":
      return and(active, lt(membership.periodEnd, t))
    case "paused":
      return eq(membership.status, "paused")
    case "cancelled":
      return eq(membership.status, "cancelled")
    default:
      return ne(membership.status, "cancelled")
  }
}

export async function listMemberships(ctx: Org, f: MembershipFilter = {}) {
  const filter = membershipFilterSchema.parse(f)
  const settings = await getMembershipSettings(ctx)
  const t = today(settings.timeZone)
  const soon = addDays(t, settings.reminderDays || 7)
  const where: (SQL | undefined)[] = [
    eq(membership.orgId, ctx.orgId),
    stateWhere(filter.state, t, soon),
  ]
  if (filter.plan) where.push(eq(membership.planId, filter.plan))
  if (filter.q) {
    const term = likeTerm(filter.q)
    where.push(
      or(ilike(customer.name, term), ilike(customer.email, term), ilike(customer.phone, term)),
    )
  }
  const cond = and(...where)
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: membership.id,
        status: membership.status,
        periodStart: membership.periodStart,
        periodEnd: membership.periodEnd,
        autoRenew: membership.autoRenew,
        customerId: customer.id,
        customerName: customer.name,
        customerEmail: customer.email,
        planName: membershipPlan.name,
        visitLimit: membershipPlan.visitLimit,
        lastVisit:
          sql<Date | null>`(select max(${membershipCheckIn.checkedInAt}) from ${membershipCheckIn} where ${membershipCheckIn.membershipId} = ${membership.id} and ${membershipCheckIn.voidedAt} is null)`.mapWith(
            (v) => (v ? new Date(v) : null),
          ),
      })
      .from(membership)
      .innerJoin(customer, eq(customer.id, membership.customerId))
      .innerJoin(membershipPlan, eq(membershipPlan.id, membership.planId))
      .where(cond)
      .orderBy(asc(membership.periodEnd), asc(customer.name))
      .limit(PAGE_SIZE)
      .offset((filter.page - 1) * PAGE_SIZE),
    db
      .select({ n: count() })
      .from(membership)
      .innerJoin(customer, eq(customer.id, membership.customerId))
      .where(cond),
  ])
  return {
    rows: rows.map((r) => ({ ...r, state: membershipState(r, t, settings.reminderDays || 7) })),
    total: total?.n ?? 0,
    page: filter.page,
    pageSize: PAGE_SIZE,
    filter,
    today: t,
  }
}

/** Active, ending soon, lapsed in the last 30 days, and visits today. */
export async function membershipSummary(ctx: Org) {
  const settings = await getMembershipSettings(ctx)
  const t = today(settings.timeZone)
  const soon = addDays(t, settings.reminderDays || 7)
  const n = (where: SQL | undefined) =>
    db
      .select({ n: count() })
      .from(membership)
      .where(and(eq(membership.orgId, ctx.orgId), where))
      .then((r) => r[0]?.n ?? 0)
  const [active, expiring, lapsed, visits] = await Promise.all([
    n(stateWhere("active", t, soon)),
    n(stateWhere("expiring", t, soon)),
    n(
      and(
        eq(membership.status, "active"),
        lt(membership.periodEnd, t),
        gte(membership.periodEnd, addDays(t, -30)),
      ),
    ),
    todaysCheckIns(ctx).then((r) => r.filter((c) => !c.voidedAt).length),
  ])
  return {
    today: t,
    active,
    expiring,
    lapsed,
    visitsToday: visits,
    soonDays: settings.reminderDays || 7,
  }
}

/** For the desk search: memberships whose customer name, email or phone matches. */
export async function findMembers(ctx: Org, q: string) {
  const term = q.trim()
  if (term.length < 2) return []
  return (await listMemberships(ctx, { q: term.slice(0, 100) })).rows.slice(0, 10)
}

/** Pickers for starting a membership. */
export async function membershipOptions(ctx: Org) {
  const [customers, plans] = await Promise.all([
    db
      .select({ id: customer.id, name: customer.name, email: customer.email })
      .from(customer)
      .where(and(eq(customer.orgId, ctx.orgId), sql`${customer.status} <> 'inactive'`))
      .orderBy(asc(customer.name))
      .limit(5000),
    listPlans(ctx),
  ])
  return { customers, plans }
}

/** A customer's memberships, for their CRM page. */
export async function customerMemberships(ctx: Org, customerId: string) {
  if (!isUuid(customerId)) return []
  return db
    .select({
      id: membership.id,
      status: membership.status,
      periodEnd: membership.periodEnd,
      planName: membershipPlan.name,
    })
    .from(membership)
    .innerJoin(membershipPlan, eq(membershipPlan.id, membership.planId))
    .where(and(eq(membership.orgId, ctx.orgId), eq(membership.customerId, customerId)))
    .orderBy(desc(membership.periodEnd))
}

// ---------- The member's card (public) ----------

/** The card page. The link is the credential; it shows only this member's own status. */
export async function getMemberCard(token: string) {
  const code = normalizeCardCode(token)
  if (!/^[A-Z0-9]{20,40}$/.test(code)) return null
  const [row] = await db
    .select({
      m: membership,
      customerName: customer.name,
      planName: membershipPlan.name,
      visitLimit: membershipPlan.visitLimit,
      orgName: organization.name,
    })
    .from(membership)
    .innerJoin(customer, eq(customer.id, membership.customerId))
    .innerJoin(membershipPlan, eq(membershipPlan.id, membership.planId))
    .innerJoin(organization, eq(organization.id, membership.orgId))
    .where(eq(membership.cardToken, code))
  if (!row) return null
  const settings = await getMembershipSettings({ orgId: row.m.orgId })
  const t = today(settings.timeZone)
  let visitsLeft: number | null = null
  if (row.visitLimit) {
    const [used] = await db
      .select({ n: count() })
      .from(membershipCheckIn)
      .where(
        and(
          eq(membershipCheckIn.membershipId, row.m.id),
          eq(membershipCheckIn.periodStart, row.m.periodStart),
          isNull(membershipCheckIn.voidedAt),
        ),
      )
    visitsLeft = Math.max(0, row.visitLimit - (used?.n ?? 0))
  }
  return {
    orgName: row.orgName,
    memberName: row.customerName,
    planName: row.planName,
    state: membershipState(row.m, t, settings.reminderDays || 7),
    periodEnd: row.m.periodEnd,
    autoRenew: row.m.autoRenew,
    visitsLeft,
    cardToken: row.m.cardToken,
  }
}

// ---------- Scheduled jobs ----------

/** Acts as the org's first owner, so jobs are attributed to a real person. */
async function ownerContext(orgId: string): Promise<MembershipContext | null> {
  const [o] = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, orgId), eq(member.role, "owner")))
    .orderBy(asc(member.createdAt))
    .limit(1)
  return o ? { orgId, user: o } : null
}

/**
 * Renews lapsed auto-renew memberships with a draft invoice, and emails one
 * reminder per period before memberships end. Safe to run as often as you
 * like: renewals check the period end, and reminders are marked as sent.
 */
export async function runMembershipJobs(opts: { orgId?: string } = {}) {
  const orgs = await db
    .selectDistinct({ orgId: membership.orgId })
    .from(membership)
    .where(
      and(
        eq(membership.status, "active"),
        opts.orgId ? eq(membership.orgId, opts.orgId) : undefined,
      ),
    )
  const out = { renewed: 0, reminded: 0, failed: 0 }
  for (const { orgId } of orgs) {
    const ctx = await ownerContext(orgId)
    if (!ctx) continue
    const settings = await getMembershipSettings(ctx)
    const t = today(settings.timeZone)
    const due = await db
      .select({ id: membership.id, periodEnd: membership.periodEnd })
      .from(membership)
      .where(
        and(
          eq(membership.orgId, orgId),
          eq(membership.status, "active"),
          eq(membership.autoRenew, true),
          lt(membership.periodEnd, t),
        ),
      )
    for (const d of due) {
      try {
        await renewMembership(ctx, d.id, { paidVia: "invoice", expectedPeriodEnd: d.periodEnd })
        out.renewed++
      } catch (e) {
        if (!(e instanceof MembershipError && e.status === 409)) {
          out.failed++
          console.error("[memberships] auto-renew failed", d.id, e)
        }
      }
    }
    if (settings.reminderDays > 0) {
      // Claim each reminder before sending, so two runs at once never email twice.
      const claimed = await db
        .update(membership)
        .set({ remindedFor: sql`${membership.periodEnd}` })
        .where(
          and(
            eq(membership.orgId, orgId),
            eq(membership.status, "active"),
            gte(membership.periodEnd, t),
            lte(membership.periodEnd, addDays(t, settings.reminderDays)),
            or(
              isNull(membership.remindedFor),
              sql`${membership.remindedFor} <> ${membership.periodEnd}`,
            ),
          ),
        )
        .returning()
      for (const m of claimed) if (await emailMember(ctx, m, "reminder")) out.reminded++
    }
  }
  return out
}

export type { Membership, PaidVia }
