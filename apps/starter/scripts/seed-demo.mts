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
const { auditLog, member, organization, user } = await import("@templates/db/schema")
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

console.info(
  `Seeded "${org.name}" with ${people.length} members and ${rows.length} activity entries.`,
)
console.info(`Switch to it from the organization menu as ${ownerEmail}.`)
process.exit(0)
