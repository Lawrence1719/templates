import {
  audit,
  auditFilterSchema,
  exportAuditCsv,
  listAuditLog,
  recordAudit,
} from "@templates/audit"
import { db } from "@templates/db"
import { auditLog } from "@templates/db/schema"
import { eq, sql } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { addMember, newOrgOwner } from "../setup/client"

const all = auditFilterSchema.parse({})
const entries = async (orgId: string) => (await listAuditLog(orgId, all)).rows

describe("audit log", () => {
  describe("automatic organization events", () => {
    it("records org creation, invitations, joins and role changes with the right actor", async () => {
      const org = await newOrgOwner("Acme")
      const member = await addMember(org, "member")
      await org.client.call("/organization/update-member-role", {
        memberId: member.memberId,
        role: "admin",
      })

      const rows = await entries(org.orgId)
      const byAction = Object.fromEntries(rows.map((r) => [r.action, r]))

      expect(byAction["organization.created"]?.actorEmail).toBe(org.email)
      expect(byAction["invitation.created"]?.actorEmail).toBe(org.email)
      expect(byAction["member.joined"]?.actorEmail).toBe(member.email)

      const roleChange = byAction["member.role_changed"]
      expect(roleChange?.actorEmail).toBe(org.email) // the owner did it, not the member
      expect(roleChange?.metadata).toMatchObject({ from: "member", to: "admin" })
    })

    it("distinguishes a removal from a member leaving", async () => {
      const org = await newOrgOwner("Acme")
      const removed = await addMember(org, "member")
      const leaver = await addMember(org, "member")

      await org.client.call("/organization/remove-member", { memberIdOrEmail: removed.memberId })
      await leaver.client.call("/organization/leave", { organizationId: org.orgId })

      const rows = await entries(org.orgId)
      expect(rows.find((r) => r.action === "member.removed")?.actorEmail).toBe(org.email)
      expect(rows.find((r) => r.action === "member.left")?.actorEmail).toBe(leaver.email)
    })

    it("records the request IP", async () => {
      const org = await newOrgOwner("Acme")
      await org.client.call("/organization/update", { data: { name: "Acme 2" } })
      const row = (await entries(org.orgId)).find((r) => r.action === "organization.updated")
      expect(row?.ip).toBe(org.client.ip)
    })
  })

  describe("tamper resistance", () => {
    it("rejects UPDATE on audit rows", async () => {
      const org = await newOrgOwner("Acme")
      await expect(
        db.update(auditLog).set({ summary: "rewritten" }).where(eq(auditLog.orgId, org.orgId)),
      ).rejects.toThrow()
      const rows = await entries(org.orgId)
      expect(rows.some((r) => r.summary === "rewritten")).toBe(false)
    })

    it("rejects DELETE on audit rows", async () => {
      const org = await newOrgOwner("Acme")
      const before = (await entries(org.orgId)).length
      await expect(db.delete(auditLog).where(eq(auditLog.orgId, org.orgId))).rejects.toThrow()
      expect((await entries(org.orgId)).length).toBe(before)
    })

    it("removes rows only when their organization is deleted", async () => {
      const org = await newOrgOwner("Acme")
      expect((await entries(org.orgId)).length).toBeGreaterThan(0)
      await org.client.call("/organization/delete", { organizationId: org.orgId })
      const [left] = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from audit_log where org_id = ${org.orgId}`,
      )
      expect(left?.n).toBe(0)
    })
  })

  describe("tenant isolation", () => {
    it("never returns another organization's entries", async () => {
      const a = await newOrgOwner("Alpha")
      const b = await newOrgOwner("Beta")
      await recordAudit({
        orgId: a.orgId,
        actor: null,
        action: "secret.thing",
        summary: "Alpha only",
      })

      const bRows = await entries(b.orgId)
      expect(bRows.every((r) => r.orgId === b.orgId)).toBe(true)
      expect(bRows.some((r) => r.summary === "Alpha only")).toBe(false)

      const csv = await exportAuditCsv(b.orgId, {})
      expect(csv).not.toContain("Alpha only")
    })
  })

  describe("filters", () => {
    it("filters by action and search text, and escapes LIKE wildcards", async () => {
      const org = await newOrgOwner("Acme")
      await recordAudit({
        orgId: org.orgId,
        actor: null,
        action: "invoice.sent",
        summary: "Sent invoice 100%",
      })
      await recordAudit({
        orgId: org.orgId,
        actor: null,
        action: "invoice.sent",
        summary: "Sent invoice 200",
      })

      const byAction = await listAuditLog(
        org.orgId,
        auditFilterSchema.parse({ action: "invoice.sent" }),
      )
      expect(byAction.total).toBe(2)

      // "%" must match literally, not as a wildcard.
      const byText = await listAuditLog(org.orgId, auditFilterSchema.parse({ q: "100%" }))
      expect(byText.rows.map((r) => r.summary)).toEqual(["Sent invoice 100%"])
    })

    it("rejects malformed filter input", () => {
      expect(auditFilterSchema.safeParse({ actor: "not-a-uuid" }).success).toBe(false)
      expect(auditFilterSchema.safeParse({ from: "yesterday" }).success).toBe(false)
      expect(auditFilterSchema.safeParse({ page: "-1" }).success).toBe(false)
    })
  })

  describe("CSV export", () => {
    it("neutralizes spreadsheet formulas and escapes quotes", async () => {
      const org = await newOrgOwner("Acme")
      await recordAudit({
        orgId: org.orgId,
        actor: null,
        action: "customer.created",
        summary: '=HYPERLINK("http://evil.example","click")',
      })
      const csv = await exportAuditCsv(org.orgId, { action: "customer.created" })
      const line = csv.split("\n")[1] ?? ""
      expect(line).toContain(`"'=HYPERLINK(""http://evil.example"",""click"")"`)
      expect(line).not.toMatch(/(^|,)"=/)
    })
  })

  describe("recording", () => {
    it("never throws, even for an invalid organization", async () => {
      await expect(
        recordAudit({
          orgId: "00000000-0000-0000-0000-000000000000",
          actor: null,
          action: "x.y",
          summary: "z",
        }),
      ).resolves.toBeUndefined()
    })

    it("caps oversized metadata", async () => {
      const org = await newOrgOwner("Acme")
      await audit(
        { orgId: org.orgId, user: { id: org.id, name: org.name, email: org.email } },
        "big.payload",
        "Huge",
        { metadata: { blob: "x".repeat(20_000) } },
      )
      const row = (await entries(org.orgId)).find((r) => r.action === "big.payload")
      expect(row?.metadata).toEqual({ truncated: true })
    })
  })
})
