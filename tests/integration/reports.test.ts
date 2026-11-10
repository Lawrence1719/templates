import { db } from "@templates/db"
import { auditLog } from "@templates/db/schema"
import { delta, formatValue, parseRange, rangeDays } from "@templates/reports"
import {
  activityByAction,
  activityMetric,
  computeMetrics,
  membersMetric,
  metricsToCsv,
  mostActivePeople,
} from "@templates/reports/server"
import { describe, expect, it } from "vitest"

import { addMember, newOrgOwner } from "../setup/client"

const NOW = new Date("2026-03-15T15:30:00Z")

/** Inserts backdated activity rows (the audit trigger allows inserts). */
async function activity(
  orgId: string,
  isoDays: string[],
  action = "order.created",
  actor?: { id: string; name: string },
) {
  if (!isoDays.length) return
  await db.insert(auditLog).values(
    isoDays.map((d) => ({
      orgId,
      action,
      summary: action,
      actorId: actor?.id ?? null,
      actorName: actor?.name ?? null,
      createdAt: new Date(`${d}T12:00:00Z`),
    })),
  )
}

describe("date ranges", () => {
  it("covers whole UTC days ending today, with an equal previous period", () => {
    const r = parseRange("7d", NOW)
    expect(r.days).toBe(7)
    expect(r.to.toISOString()).toBe("2026-03-16T00:00:00.000Z")
    expect(r.from.toISOString()).toBe("2026-03-09T00:00:00.000Z")
    expect(r.previousFrom.toISOString()).toBe("2026-03-02T00:00:00.000Z")
    expect(rangeDays(r)).toEqual([
      "2026-03-09",
      "2026-03-10",
      "2026-03-11",
      "2026-03-12",
      "2026-03-13",
      "2026-03-14",
      "2026-03-15",
    ])
  })

  it("falls back to 30 days for anything unexpected", () => {
    for (const v of [undefined, "", "365d", "7", ["7d"], "<script>"])
      expect(parseRange(v, NOW).preset).toBe("30d")
  })
})

describe("formatting", () => {
  it("writes small numbers in full and large ones compact", () => {
    expect(formatValue(1284)).toBe("1,284")
    expect(formatValue(12_900)).toBe("12.9K")
    expect(formatValue(4_200_000, "currency")).toBe("$4.2M")
    expect(formatValue(0.256, "percent")).toBe("26%")
  })

  it("computes relative change and refuses a zero base", () => {
    expect(delta(150, 100)).toBe(0.5)
    expect(delta(50, 100)).toBe(-0.5)
    expect(delta(5, 0)).toBeNull()
    expect(delta(0, 0)).toBe(0)
    expect(delta(5, null)).toBeNull()
  })
})

describe("metrics", () => {
  it("buckets activity by UTC day, zero-fills gaps, and compares with the previous period", async () => {
    const org = await newOrgOwner("Acme")
    const r = parseRange("7d", NOW)
    // Org creation logged an entry "now" (outside this fixed range), so it doesn't count.
    await activity(org.orgId, ["2026-03-09", "2026-03-09", "2026-03-12", "2026-03-15"]) // current: 4
    await activity(org.orgId, ["2026-03-03", "2026-03-05"]) // previous: 2
    await activity(org.orgId, ["2026-03-16", "2026-03-01"]) // outside both periods

    const [m] = await computeMetrics([activityMetric], org.orgId, r)
    expect(m?.value).toBe(4)
    expect(m?.previous).toBe(2)
    expect(m?.series.map((p) => p.value)).toEqual([2, 0, 0, 1, 0, 0, 1])
  })

  it("never counts another organization's rows", async () => {
    const a = await newOrgOwner("Alpha")
    const b = await newOrgOwner("Beta")
    const r = parseRange("7d", NOW)
    await activity(a.orgId, ["2026-03-10", "2026-03-11", "2026-03-12"], "secret.alpha")

    const [mb] = await computeMetrics([activityMetric], b.orgId, r)
    expect(mb?.value).toBe(0)
    expect(await activityByAction.compute(b.orgId, r)).toEqual([])
  })

  it("keeps a running member total", async () => {
    const org = await newOrgOwner("Acme")
    await addMember(org, "member")
    await addMember(org, "member")
    const r = parseRange("7d") // members were created just now
    const [m] = await computeMetrics([membersMetric], org.orgId, r)
    expect(m?.value).toBe(3)
    expect(m?.previous).toBe(0)
    expect(m?.series.at(-1)?.value).toBe(3)
    // Monotonic running total
    const values = m?.series.map((p) => p.value) ?? []
    expect(values).toEqual([...values].sort((x, y) => x - y))
  })

  it("ranks activity types and people", async () => {
    const org = await newOrgOwner("Acme")
    const r = parseRange("7d", NOW)
    const ana = { id: org.id, name: org.name }
    await activity(org.orgId, ["2026-03-10", "2026-03-11", "2026-03-12"], "invoice.sent", ana)
    await activity(org.orgId, ["2026-03-13"], "order.created", ana)

    expect(await activityByAction.compute(org.orgId, r)).toEqual([
      { label: "invoice.sent", value: 3 },
      { label: "order.created", value: 1 },
    ])
    expect(await mostActivePeople.compute(org.orgId, r)).toEqual([{ label: org.name, value: 4 }])
  })
})

describe("CSV", () => {
  it("writes one row per day plus totals, with formula-safe cells", () => {
    const csv = metricsToCsv([
      {
        id: "a",
        label: "=cmd()",
        value: 3,
        previous: 1,
        series: [
          { date: "2026-03-14", value: 1 },
          { date: "2026-03-15", value: 2 },
        ],
      },
    ])
    expect(csv.split("\n")).toEqual([
      `"date","'=cmd()"`,
      `"2026-03-14","1"`,
      `"2026-03-15","2"`,
      `"total","3"`,
    ])
  })
})
