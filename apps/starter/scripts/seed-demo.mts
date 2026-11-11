/**
 * Fills a demo organization with ~90 days of members and activity so the
 * dashboard has something to show. Safe to re-run: it creates a fresh org each time.
 *
 *   pnpm --filter @templates/starter seed:demo -- owner@example.test
 *
 * The given user (must already exist) becomes the owner of the demo org.
 */
import { existsSync } from "node:fs"

if (existsSync("../../.env")) process.loadEnvFile("../../.env")

const { db } = await import("@templates/db")
const {
  auditLog,
  crmActivity,
  customer,
  customerContact,
  deal,
  member,
  organization,
  project,
  task,
  taskChecklistItem,
  taskComment,
  user,
} = await import("@templates/db/schema")
const { eq } = await import("drizzle-orm")

const ownerEmail = process.argv.slice(2).find((a) => a.includes("@"))
if (!ownerEmail) throw new Error("Usage: seed:demo -- <owner-email>")
const [owner] = await db.select().from(user).where(eq(user.email, ownerEmail))
if (!owner) throw new Error(`No user ${ownerEmail}. Sign up first.`)

const DAY = 86_400_000
const now = Date.now()
const daysAgo = (d: number, jitterHours = 8) =>
  new Date(now - d * DAY - Math.random() * jitterHours * 3_600_000)
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)] as T

const [org] = await db
  .insert(organization)
  .values({
    name: "Northwind Trading",
    slug: `northwind-${now.toString(36)}`,
    createdAt: daysAgo(95),
  })
  .returning()
if (!org) throw new Error("org insert failed")

await db
  .insert(member)
  .values({ organizationId: org.id, userId: owner.id, role: "owner", createdAt: daysAgo(95) })

const first = [
  "Ana",
  "Ben",
  "Carla",
  "Dev",
  "Eli",
  "Faye",
  "Gio",
  "Hana",
  "Ivan",
  "Jules",
  "Kai",
  "Lia",
  "Marco",
  "Nina",
  "Omar",
  "Pia",
  "Quinn",
  "Rosa",
]
const last = [
  "Reyes",
  "Cruz",
  "Santos",
  "Lim",
  "Tan",
  "Garcia",
  "Mendoza",
  "Bautista",
  "Ramos",
  "Torres",
]

// Members join steadily, a little faster recently.
const people: { id: string; name: string; email: string }[] = [
  { id: owner.id, name: owner.name, email: owner.email },
]
for (let i = 0; i < first.length; i++) {
  const name = `${first[i]} ${pick(last)}`
  const joined = Math.round(90 - (i / first.length) ** 0.8 * 88)
  const [u] = await db
    .insert(user)
    .values({
      name,
      email: `${name.toLowerCase().replace(/\W+/g, ".")}.${now.toString(36)}@demo.test`,
      emailVerified: true,
      createdAt: daysAgo(joined),
    })
    .returning()
  if (!u) continue
  await db.insert(member).values({
    organizationId: org.id,
    userId: u.id,
    role: i < 3 ? "admin" : "member",
    createdAt: daysAgo(joined),
  })
  people.push({ id: u.id, name: u.name, email: u.email })
  await db.insert(auditLog).values({
    orgId: org.id,
    actorId: u.id,
    actorName: u.name,
    actorEmail: u.email,
    action: "member.joined",
    summary: `${u.name} joined as ${i < 3 ? "admin" : "member"}`,
    createdAt: daysAgo(joined),
  })
}

// Weekday-heavy activity that grows over the period.
const events = [
  ["customer.created", "Added customer"],
  ["customer.updated", "Updated customer"],
  ["order.created", "Created order"],
  ["order.fulfilled", "Fulfilled order"],
  ["invoice.sent", "Sent invoice"],
  ["stock.adjusted", "Adjusted stock for"],
] as const
const companies = [
  "Bluebay Foods",
  "Kestrel Labs",
  "Harbor & Co",
  "Pinecrest",
  "Sunline Retail",
  "Atlas Hardware",
]
const rows: (typeof auditLog.$inferInsert)[] = []
for (let d = 89; d >= 0; d--) {
  const weekday = new Date(now - d * DAY).getUTCDay()
  const base = 4 + (90 - d) / 9
  const n = Math.round(
    base * (weekday === 0 || weekday === 6 ? 0.3 : 1) * (0.7 + Math.random() * 0.6),
  )
  const active = people.slice(0, Math.max(2, Math.round(people.length * (1 - d / 100))))
  for (let k = 0; k < n; k++) {
    const who = Math.random() < 0.35 ? (people[1] ?? people[0]!) : pick(active)
    const [action, verb] = pick([...events])
    rows.push({
      orgId: org.id,
      actorId: who.id,
      actorName: who.name,
      actorEmail: who.email,
      action,
      summary: `${verb} ${pick(companies)}`,
      createdAt: daysAgo(d, 10),
    })
  }
}
for (let i = 0; i < rows.length; i += 500) await db.insert(auditLog).values(rows.slice(i, i + 500))

// ---------- CRM: customers, contacts, deals and timelines ----------
const reps = people.slice(0, 6)
const accounts = [
  ["Bluebay Foods", "wholesale, food", "active"],
  ["Kestrel Labs", "software", "active"],
  ["Harbor & Co", "retail", "active"],
  ["Pinecrest Clinics", "healthcare, vip", "active"],
  ["Sunline Retail", "retail", "lead"],
  ["Atlas Hardware", "wholesale", "active"],
  ["Mariner Logistics", "logistics", "lead"],
  ["Orchid Hotels", "hospitality, vip", "active"],
  ["Copperleaf Cafe", "food", "lead"],
  ["Granite Builders", "construction", "inactive"],
  ["Lumen Studio", "creative", "lead"],
  ["Northstar Schools", "education", "active"],
] as const
const roles = ["Owner", "Operations Manager", "Purchasing", "Finance Lead", "CEO"]
const dealNames = [
  "Annual supply contract",
  "Pilot program",
  "Website rebuild",
  "Q3 restock",
  "Support plan",
  "Expansion",
]
const notes = [
  ["call", "Intro call. Interested in monthly delivery, wants pricing by Friday."],
  ["email", "Sent the proposal and the product sheet."],
  ["meeting", "Site visit with the operations team. They want a trial in two branches."],
  ["note", "Decision maker is the finance lead. Budget approved for next quarter."],
  ["call", "Follow-up: asked for net-30 terms."],
] as const
let crmCount = 0
for (const [i, [name, tags, status]] of accounts.entries()) {
  const owner = reps[i % reps.length]!
  const created = daysAgo(80 - i * 6)
  const domain = name.toLowerCase().replace(/[^a-z]+/g, "")
  const [c] = await db
    .insert(customer)
    .values({
      orgId: org.id,
      kind: "company",
      name,
      email: `hello@${domain}.example`,
      phone: `+1 555 01${String(10 + i).padStart(2, "0")}`,
      website: `https://${domain}.example`,
      status,
      ownerId: owner.id,
      tags: tags.split(", "),
      createdBy: owner.id,
      createdAt: created,
      updatedAt: daysAgo(Math.max(0, 40 - i * 3)),
    })
    .returning()
  if (!c) continue
  crmCount++
  const contactCount = 1 + (i % 3)
  for (let k = 0; k < contactCount; k++) {
    const person = `${pick(first)} ${pick(last)}`
    await db.insert(customerContact).values({
      orgId: org.id,
      customerId: c.id,
      name: person,
      title: roles[(i + k) % roles.length],
      email: `${person.toLowerCase().replace(/\W+/g, ".")}@${domain}.example`,
      isPrimary: k === 0,
    })
  }
  await db.insert(crmActivity).values({
    orgId: org.id,
    customerId: c.id,
    kind: "system",
    body: `${owner.name} added ${name}`,
    createdBy: owner.id,
    occurredAt: created,
  })
  for (let k = 0; k < 2 + (i % 3); k++) {
    const [kind, body] = notes[(i + k) % notes.length]!
    await db.insert(crmActivity).values({
      orgId: org.id,
      customerId: c.id,
      kind,
      body,
      createdBy: owner.id,
      occurredAt: daysAgo(Math.max(1, 70 - i * 5 - k * 6)),
    })
  }
  if (status === "inactive") continue
  const stages = ["new", "qualified", "proposal", "won", "lost"] as const
  for (let k = 0; k < 1 + (i % 2); k++) {
    const stage = stages[(i + k * 2) % stages.length]!
    const closed = stage === "won" || stage === "lost"
    const close = new Date(now + (((i * 7 + k * 11) % 60) - 15) * DAY).toISOString().slice(0, 10)
    await db.insert(deal).values({
      orgId: org.id,
      customerId: c.id,
      title: dealNames[(i + k) % dealNames.length]!,
      valueCents: (1500 + ((i * 3917 + k * 2711) % 48000)) * 100,
      currency: i % 5 === 4 ? "EUR" : "USD",
      stage,
      ownerId: owner.id,
      expectedCloseOn: close,
      closedAt: closed ? daysAgo(5 + i) : null,
      createdBy: owner.id,
      createdAt: daysAgo(40 - i),
    })
  }
}

// ---------- Tasks & projects ----------
const day = (offset: number) => new Date(now + offset * DAY).toISOString().slice(0, 10)
const team = [people[0]!, ...people.slice(1, 6)]
const projectsSeed = [
  {
    name: "Second branch opening",
    description: "Lease, fit-out, hiring and launch for the Makati branch.",
  },
  {
    name: "Year-end close",
    description: "Inventory count, reconciliations and reports for the auditors.",
  },
  { name: "Website refresh", description: "New product pages and online ordering." },
]
let taskCount = 0
for (const [pi, ps] of projectsSeed.entries()) {
  const [p] = await db
    .insert(project)
    .values({ orgId: org.id, ...ps, createdBy: owner.id, createdAt: daysAgo(30 - pi * 8) })
    .returning()
  if (!p) continue
  const titles = [
    [
      "Sign the lease",
      "Order signage",
      "Hire 4 staff",
      "Set up POS terminals",
      "Soft launch",
      "Opening day promo",
    ],
    [
      "Full stock count",
      "Reconcile bank accounts",
      "Chase unpaid invoices",
      "Prepare audit pack",
      "File year-end reports",
    ],
    [
      "Write product copy",
      "Photograph new range",
      "Set up online payments",
      "Test checkout on mobile",
    ],
  ][pi]!
  for (const [ti, title] of titles.entries()) {
    const status = ti < 2 ? "done" : ti === 2 ? "in_progress" : "todo"
    const [t] = await db
      .insert(task)
      .values({
        orgId: org.id,
        projectId: p.id,
        title,
        status,
        priority: ti === 3 ? "high" : ti === 4 && pi === 1 ? "urgent" : "normal",
        assigneeId: team[(ti + pi) % team.length]!.id,
        dueOn: day(ti * 4 - 6 + pi * 3),
        completedAt: status === "done" ? daysAgo(6 - ti) : null,
        createdBy: owner.id,
        createdAt: daysAgo(25 - ti),
      })
      .returning()
    if (!t) continue
    taskCount++
    if (ti === 3)
      await db.insert(taskChecklistItem).values(
        ["Get quotes", "Pick a supplier", "Install", "Train staff"].map((text, position) => ({
          orgId: org.id,
          taskId: t.id,
          text,
          position,
          done: position < 2,
        })),
      )
    if (ti === 2)
      await db.insert(taskComment).values({
        orgId: org.id,
        taskId: t.id,
        body: "Two candidates confirmed for interviews on Thursday.",
        authorId: team[1]!.id,
        createdAt: daysAgo(2),
      })
  }
}
// Loose tasks for the owner, so "My tasks" has every bucket.
const mine: [string, number | null, "low" | "normal" | "high" | "urgent"][] = [
  ["Approve supplier payments", -2, "urgent"],
  ["Review weekly sales report", 0, "high"],
  ["Call Bluebay Foods about renewal", 0, "normal"],
  ["Update staff schedule", 3, "normal"],
  ["Renew business permit", 20, "high"],
  ["Read the new tax guidelines", null, "low"],
]
for (const [title, offset, priority] of mine) {
  await db.insert(task).values({
    orgId: org.id,
    title,
    priority,
    assigneeId: owner.id,
    dueOn: offset === null ? null : day(offset),
    createdBy: people[1]!.id,
  })
  taskCount++
}
await db.insert(task).values({
  orgId: org.id,
  title: "Weekly cash count",
  assigneeId: owner.id,
  dueOn: day(1),
  recurrence: "weekly",
  createdBy: owner.id,
})
taskCount++

console.info(
  `Seeded "${org.name}" with ${people.length} members, ${rows.length} activity entries, ${crmCount} customers and ${taskCount} tasks.`,
)
console.info(`Switch to it from the organization menu as ${ownerEmail}.`)
process.exit(0)
