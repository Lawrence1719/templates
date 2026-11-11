import { listAuditLog } from "@templates/audit"
import {
  activityInputSchema,
  addContact,
  createCustomer,
  createDeal,
  customerInputSchema,
  customersCsv,
  DEAL_STAGES,
  deleteActivity,
  deleteContact,
  deleteCustomer,
  fieldErrors,
  getCustomer,
  listCustomers,
  listDeals,
  logActivity,
  moveDeal,
  parseMoney,
  pipelineSummary,
  updateCustomer,
  updateDeal,
} from "@templates/crm"
import { db } from "@templates/db"
import { crmActivity, customerContact, DEAL_STAGES as DB_STAGES, deal } from "@templates/db/schema"
import { listNotifications } from "@templates/notifications"
import { eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { addMember, newOrgOwner } from "../setup/client"

type Person = { id: string; name: string; email: string }
const ctxOf = (orgId: string, u: Person) => ({
  orgId,
  user: { id: u.id, name: u.name, email: u.email },
})

const base = { kind: "company", status: "lead", name: "Northwind" } as const

async function setup() {
  const org = await newOrgOwner("Acme")
  const ctx = ctxOf(org.orgId, org)
  return { org, ctx }
}

describe("validation", () => {
  it("normalizes tags, websites and empty fields", () => {
    const r = customerInputSchema.parse({
      ...base,
      email: "  ",
      website: "northwind.example",
      tags: " VIP, wholesale ,vip,  ",
    })
    expect(r.email).toBeNull()
    expect(r.website).toBe("https://northwind.example")
    expect(r.tags).toEqual(["vip", "wholesale"])
  })

  it.each([
    [{ name: "  " }, "name", "Enter a name"],
    [{ email: "nope" }, "email", "Enter a valid email"],
    [{ phone: "call me" }, "phone", "Use digits, spaces and + ( ) - only"],
    [{ website: "javascript:alert(1)" }, "website", "Enter a website like example.com"],
    [{ status: "vip" }, "status", "Choose a status"],
    [{ ownerId: "not-an-id" }, "ownerId", "Choose someone from the list"],
    [{ tags: "a,b,c,d,e,f,g,h,i,j,k" }, "tags", "Use at most 10 tags"],
  ])("rejects %j", (patch, field, message) => {
    const r = customerInputSchema.safeParse({ ...base, ...patch })
    expect(r.success).toBe(false)
    if (!r.success) expect(fieldErrors(r.error)[field]).toBe(message)
  })

  it("parses money without float errors", () => {
    expect(parseMoney("1,250.5")).toBe(125050)
    expect(parseMoney("0.29")).toBe(29)
    expect(parseMoney("19.999")).toBeNull()
    expect(parseMoney("-5")).toBeNull()
    expect(parseMoney("1e3")).toBeNull()
  })

  it("rejects activity dates far in the future", () => {
    const later = new Date(Date.now() + 2 * 365 * 86_400_000).toISOString()
    expect(
      activityInputSchema.safeParse({ kind: "call", body: "x", occurredAt: later }).success,
    ).toBe(false)
  })

  it("keeps stage lists in sync between the module and the schema", () => {
    expect(DEAL_STAGES).toEqual(DB_STAGES)
  })
})

describe("customers", () => {
  it("creates, updates and records the history", async () => {
    const { org, ctx } = await setup()
    const c = await createCustomer(ctx, { ...base, tags: "vip" })
    await updateCustomer(ctx, c.id, {
      ...base,
      tags: "vip",
      status: "active",
      phone: "+1 555 0100",
    })

    const { customer, activity } = await getCustomer(ctx, c.id)
    expect(customer.status).toBe("active")
    expect(activity.map((a) => a.body)).toEqual([
      expect.stringContaining("changed status from Lead to Active"),
      expect.stringContaining("added Northwind"),
    ])
    const log = await listAuditLog(org.orgId, { page: 1 })
    const updated = log.rows.find((r) => r.action === "customer.updated")
    expect(updated?.metadata).toEqual({ changed: ["phone", "status"] })
  })

  it("doesn't write an update when nothing changed", async () => {
    const { org, ctx } = await setup()
    const c = await createCustomer(ctx, base)
    await updateCustomer(ctx, c.id, base)
    const log = await listAuditLog(org.orgId, { page: 1 })
    expect(log.rows.some((r) => r.action === "customer.updated")).toBe(false)
  })

  it("only lets members of the org own a customer", async () => {
    const { ctx } = await setup()
    const stranger = await newOrgOwner("Other")
    await expect(createCustomer(ctx, { ...base, ownerId: stranger.id })).rejects.toMatchObject({
      status: 400,
      fieldErrors: { ownerId: "Choose someone in this organization" },
    })
  })

  it("tells the new owner, but not someone assigning themselves", async () => {
    const { org, ctx } = await setup()
    const rep = await addMember(org, "member")
    const c = await createCustomer(ctx, { ...base, ownerId: org.id })
    // (The owner already has a "member.joined" notice from the rep joining.)
    const ownerInbox = await listNotifications({ userId: org.id, orgId: org.orgId })
    expect(ownerInbox.map((n) => n.type)).not.toContain("crm.assigned")

    await updateCustomer(ctx, c.id, { ...base, ownerId: rep.id })
    const inbox = await listNotifications({ userId: rep.id, orgId: org.orgId })
    expect(inbox[0]).toMatchObject({ type: "crm.assigned", link: `/customers/${c.id}` })
  })

  it("searches by name, email, contact and with LIKE characters taken literally", async () => {
    const { ctx } = await setup()
    const a = await createCustomer(ctx, { ...base, name: "Contoso 100%" })
    const b = await createCustomer(ctx, { ...base, name: "Fabrikam", email: "ap@fabrikam.example" })
    await addContact(ctx, b.id, { name: "Priya Shah" })
    await createCustomer(ctx, { ...base, name: "Litware 1000" })

    const names = async (q: string) =>
      (await listCustomers(ctx, { q })).rows.map((r) => r.name).sort()
    expect(await names("100%")).toEqual([a.name])
    expect(await names("fabrikam.example")).toEqual(["Fabrikam"])
    expect(await names("priya")).toEqual(["Fabrikam"])
  })

  it("filters by status, owner and tag, and pages through results", async () => {
    const { org, ctx } = await setup()
    const rep = await addMember(org, "member")
    for (let i = 0; i < 27; i++) await createCustomer(ctx, { ...base, name: `Lead ${i}` })
    await createCustomer(ctx, {
      ...base,
      name: "Mine",
      status: "active",
      ownerId: org.id,
      tags: "vip",
    })
    await createCustomer(ctx, { ...base, name: "Theirs", ownerId: rep.id })

    const all = await listCustomers(ctx)
    expect(all.total).toBe(29)
    expect(all.rows).toHaveLength(25)
    expect((await listCustomers(ctx, { page: 2 })).rows).toHaveLength(4)
    expect((await listCustomers(ctx, { status: "active" })).rows.map((r) => r.name)).toEqual([
      "Mine",
    ])
    expect(
      (await listCustomers({ ...ctx, userId: org.id }, { owner: "me" })).rows.map((r) => r.name),
    ).toEqual(["Mine"])
    expect((await listCustomers(ctx, { owner: rep.id })).rows.map((r) => r.name)).toEqual([
      "Theirs",
    ])
    expect((await listCustomers(ctx, { tag: "VIP" })).rows.map((r) => r.name)).toEqual(["Mine"])
    expect((await listCustomers(ctx, { owner: "none" })).total).toBe(27)
  })

  it("deletes contacts, deals and the timeline with the customer", async () => {
    const { ctx } = await setup()
    const c = await createCustomer(ctx, base)
    await addContact(ctx, c.id, { name: "Ana" })
    await createDeal(ctx, c.id, { title: "Pilot", value: "500", currency: "USD", stage: "new" })
    await deleteCustomer(ctx, c.id)
    for (const t of [customerContact, deal, crmActivity])
      expect(await db.select().from(t).where(eq(t.customerId, c.id))).toHaveLength(0)
  })

  it("exports CSV safely", async () => {
    const { ctx } = await setup()
    await createCustomer(ctx, { ...base, name: '=HYPERLINK("http://evil")', tags: "vip, retail" })
    const csv = await customersCsv(ctx)
    expect(csv.split("\n")[0]).toContain('"name","type","status"')
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`)
    expect(csv).toContain('"vip; retail"')
  })
})

describe("contacts", () => {
  it("keeps exactly one primary contact", async () => {
    const { ctx } = await setup()
    const c = await createCustomer(ctx, base)
    const ana = await addContact(ctx, c.id, { name: "Ana" })
    expect(ana.isPrimary).toBe(true)
    const ben = await addContact(ctx, c.id, { name: "Ben", isPrimary: "on" })
    const primaries = async () =>
      (await getCustomer(ctx, c.id)).contacts.filter((x) => x.isPrimary).map((x) => x.name)
    expect(await primaries()).toEqual(["Ben"])
    await deleteContact(ctx, ben.id)
    expect(await primaries()).toEqual(["Ana"])
  })
})

describe("deals", () => {
  it("moves through the pipeline, stamping close dates and logging each move", async () => {
    const { ctx } = await setup()
    const c = await createCustomer(ctx, base)
    const d = await createDeal(ctx, c.id, {
      title: "Annual plan",
      value: "12,000",
      currency: "USD",
      stage: "new",
    })
    expect(d.valueCents).toBe(1_200_000)
    expect(d.closedAt).toBeNull()

    const won = await moveDeal(ctx, d.id, "won")
    expect(won.closedAt).toBeInstanceOf(Date)
    const reopened = await moveDeal(ctx, d.id, "proposal")
    expect(reopened.closedAt).toBeNull()

    const { activity } = await getCustomer(ctx, c.id)
    expect(activity.filter((a) => a.dealId === d.id).map((a) => a.body)).toEqual([
      expect.stringContaining("from Won to Proposal"),
      expect.stringContaining("from New to Won"),
      expect.stringContaining('opened deal "Annual plan" ($12,000.00)'),
    ])
  })

  it("tells owners, admins and the deal owner when a deal is won", async () => {
    const { org } = await setup()
    const admin = await addMember(org, "admin")
    const rep = await addMember(org, "member")
    const bystander = await addMember(org, "member")
    const repCtx = ctxOf(org.orgId, rep)
    const c = await createCustomer(repCtx, base)
    const d = await createDeal(repCtx, c.id, {
      title: "Big one",
      value: "900",
      currency: "EUR",
      stage: "proposal",
      ownerId: rep.id,
    })
    await moveDeal(repCtx, d.id, "won")

    for (const u of [org, admin]) {
      const inbox = await listNotifications({ userId: u.id, orgId: org.orgId })
      expect(inbox.map((n) => n.type)).toContain("deal.won")
    }
    // The rep closed it themselves, so they aren't told about it.
    expect(
      (await listNotifications({ userId: rep.id, orgId: org.orgId })).map((n) => n.type),
    ).not.toContain("deal.won")
    expect(await listNotifications({ userId: bystander.id, orgId: org.orgId })).toHaveLength(0)
  })

  it("sums the pipeline per stage and currency", async () => {
    const { ctx } = await setup()
    const c = await createCustomer(ctx, base)
    const add = (value: string, currency: "USD" | "EUR", stage: "new" | "won" | "lost") =>
      createDeal(ctx, c.id, { title: "D", value, currency, stage })
    await add("100", "USD", "new")
    await add("50.50", "USD", "new")
    await add("70", "EUR", "new")
    await add("999", "USD", "lost")
    const summary = await pipelineSummary(ctx)
    expect(summary).toEqual(
      expect.arrayContaining([
        { stage: "new", currency: "USD", deals: 2, valueCents: 15_050 },
        { stage: "new", currency: "EUR", deals: 1, valueCents: 7_000 },
      ]),
    )
    expect(summary.some((s) => s.stage === "lost")).toBe(false)
  })

  it("rejects bad amounts with a field error", async () => {
    const { ctx } = await setup()
    const c = await createCustomer(ctx, base)
    await expect(
      updateDeal(
        ctx,
        (await createDeal(ctx, c.id, { title: "D", value: "1", currency: "USD", stage: "new" })).id,
        { title: "D", value: "12.345", currency: "USD", stage: "new" },
      ),
    ).rejects.toMatchObject({ status: 400, fieldErrors: { value: expect.any(String) } })
  })
})

describe("timeline", () => {
  it("lets people delete only what they logged, and nobody delete automatic entries", async () => {
    const { org, ctx } = await setup()
    const rep = await addMember(org, "member")
    const repCtx = ctxOf(org.orgId, rep)
    const c = await createCustomer(ctx, base)
    const mine = await logActivity(repCtx, c.id, { kind: "call", body: "Intro call" })
    const owners = await logActivity(ctx, c.id, { kind: "note", body: "Pricing sensitive" })
    if (!mine || !owners) throw new Error("not logged")

    await expect(deleteActivity(repCtx, owners.id, { canDeleteAny: false })).rejects.toMatchObject({
      status: 403,
    })
    await deleteActivity(repCtx, mine.id, { canDeleteAny: false })
    await deleteActivity(ctx, owners.id, { canDeleteAny: true })

    const system = (await getCustomer(ctx, c.id)).activity.find((a) => a.kind === "system")
    if (!system) throw new Error("no system entry")
    await expect(deleteActivity(ctx, system.id, { canDeleteAny: true })).rejects.toMatchObject({
      status: 409,
    })
  })
})

describe("org isolation", () => {
  it("can't read, change or attach to another org's records", async () => {
    const a = await setup()
    const b = await setup()
    const c = await createCustomer(a.ctx, base)
    const d = await createDeal(a.ctx, c.id, {
      title: "D",
      value: "1",
      currency: "USD",
      stage: "new",
    })
    const other = await createCustomer(b.ctx, { ...base, name: "B's customer" })

    const notFound = { status: 404 }
    await expect(getCustomer(b.ctx, c.id)).rejects.toMatchObject(notFound)
    await expect(updateCustomer(b.ctx, c.id, base)).rejects.toMatchObject(notFound)
    await expect(deleteCustomer(b.ctx, c.id)).rejects.toMatchObject(notFound)
    await expect(addContact(b.ctx, c.id, { name: "X" })).rejects.toMatchObject(notFound)
    await expect(
      createDeal(b.ctx, c.id, { title: "X", value: "1", currency: "USD", stage: "new" }),
    ).rejects.toMatchObject(notFound)
    await expect(moveDeal(b.ctx, d.id, "won")).rejects.toMatchObject(notFound)
    await expect(logActivity(b.ctx, c.id, { kind: "note", body: "x" })).rejects.toMatchObject(
      notFound,
    )
    // A deal from org A can't be attached to org B's customer's timeline.
    await expect(
      logActivity(b.ctx, other.id, { kind: "note", body: "x", dealId: d.id }),
    ).rejects.toMatchObject(notFound)

    expect((await listCustomers(b.ctx)).rows.map((r) => r.name)).toEqual(["B's customer"])
    expect(await listDeals(b.ctx)).toHaveLength(0)
    expect(await customersCsv(b.ctx)).not.toContain("Northwind")
  })

  it("the database itself refuses a row pointing at another org's customer", async () => {
    const a = await setup()
    const b = await setup()
    const c = await createCustomer(a.ctx, base)
    await expect(
      db.insert(customerContact).values({ orgId: b.org.orgId, customerId: c.id, name: "Sneaky" }),
    ).rejects.toThrow()
  })
})

describe("permissions", () => {
  it.each([
    ["member", { customer: ["read", "write"], deal: ["read", "write"] }, true],
    ["member", { customer: ["delete"] }, false],
    ["member", { deal: ["delete"] }, false],
    ["admin", { customer: ["delete"], deal: ["delete"] }, true],
  ] as const)("%s → %j is %s", async (role, permissions, expected) => {
    const org = await newOrgOwner("Acme")
    const m = await addMember(org, role)
    expect(
      (await m.client.call("/organization/has-permission", { permissions })).data.success,
    ).toBe(expected)
  })
})
