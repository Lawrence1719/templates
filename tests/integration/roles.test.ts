import { describe, expect, it } from "vitest"

import { addMember, isDenied, newOrgOwner } from "../setup/client"

describe("role permissions", () => {
  describe("member", () => {
    it("cannot invite, change roles, rename or delete the organization", async () => {
      const org = await newOrgOwner("Acme")
      const member = await addMember(org, "member")
      const other = await addMember(org, "member")
      const c = member.client

      const attempts = [
        c.call("/organization/invite-member", { email: "a@example.test", role: "member" }),
        c.call("/organization/update-member-role", { memberId: other.memberId, role: "admin" }),
        c.call("/organization/remove-member", { memberIdOrEmail: other.memberId }),
        c.call("/organization/update", { data: { name: "Hacked" } }),
        c.call("/organization/delete", { organizationId: org.orgId }),
      ]
      for (const res of await Promise.all(attempts)) expect(isDenied(res.status)).toBe(true)

      // Nothing changed.
      const full = await org.client.call("/organization/get-full-organization")
      expect(full.data.name).toBe("Acme")
      expect(full.data.members).toHaveLength(3)
    })

    it("cannot promote themselves", async () => {
      const org = await newOrgOwner("Acme")
      const member = await addMember(org, "member")
      const res = await member.client.call("/organization/update-member-role", {
        memberId: member.memberId,
        role: "owner",
      })
      expect(isDenied(res.status)).toBe(true)
    })
  })

  describe("admin", () => {
    it("can invite and manage members", async () => {
      const org = await newOrgOwner("Acme")
      const admin = await addMember(org, "admin")
      const member = await addMember(org, "member")
      const c = admin.client

      expect(
        (await c.call("/organization/invite-member", { email: "b@example.test", role: "member" }))
          .status,
      ).toBe(200)
      expect(
        (
          await c.call("/organization/update-member-role", {
            memberId: member.memberId,
            role: "admin",
          })
        ).status,
      ).toBe(200)
      expect((await c.call("/organization/update", { data: { name: "Acme 2" } })).status).toBe(200)
    })

    it("cannot delete the organization", async () => {
      const org = await newOrgOwner("Acme")
      const admin = await addMember(org, "admin")
      const res = await admin.client.call("/organization/delete", { organizationId: org.orgId })
      expect(res.status).toBe(403)
    })
  })

  describe("owner", () => {
    it("can delete the organization", async () => {
      const org = await newOrgOwner("Acme")
      const res = await org.client.call("/organization/delete", { organizationId: org.orgId })
      expect(res.status).toBe(200)
    })
  })

  describe("permission checks", () => {
    it.each([
      ["owner", { billing: ["update"] }, true],
      ["admin", { billing: ["update"] }, false],
      ["admin", { audit: ["read"] }, true],
      ["member", { audit: ["read"] }, false],
      ["member", { member: ["delete"] }, false],
    ] as const)("%s → %j is %s", async (role, permissions, expected) => {
      const org = await newOrgOwner("Acme")
      const client = role === "owner" ? org.client : (await addMember(org, role)).client
      const res = await client.call("/organization/has-permission", { permissions })
      expect(res.data.success).toBe(expected)
    })
  })
})
