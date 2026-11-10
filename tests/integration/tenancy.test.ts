import { describe, expect, it } from "vitest"

import { addMember, newOrgOwner, newUser } from "../setup/client"

describe("tenant isolation", () => {
  it("a non-member cannot read another organization", async () => {
    const acme = await newOrgOwner("Acme")
    const outsider = await newOrgOwner("Other")
    const res = await outsider.client.call(
      `/organization/get-full-organization?organizationId=${acme.orgId}`,
    )
    expect(res.status).toBe(403)
  })

  it("a non-member cannot switch into another organization", async () => {
    const acme = await newOrgOwner("Acme")
    const outsider = await newUser()
    const res = await outsider.client.call("/organization/set-active", {
      organizationId: acme.orgId,
    })
    expect(res.status).toBe(403)
  })

  it("a non-member cannot invite into another organization", async () => {
    const acme = await newOrgOwner("Acme")
    const outsider = await newOrgOwner("Other")
    const res = await outsider.client.call("/organization/invite-member", {
      email: "x@example.test",
      role: "member",
      organizationId: acme.orgId,
    })
    // Refused because the outsider has no membership there.
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.data.code).toMatch(/MEMBER_NOT_FOUND|NOT_ALLOWED|NOT_A_MEMBER/)
    const invites = await acme.client.call("/organization/list-invitations")
    expect(invites.data).toHaveLength(0)
  })

  it("lists only the organizations a user belongs to", async () => {
    const a = await newOrgOwner("Alpha")
    await newOrgOwner("Beta")
    const res = await a.client.call("/organization/list")
    expect(res.data.map((o: { id: string }) => o.id)).toEqual([a.orgId])
  })

  it("an invitation can only be accepted by the invited email", async () => {
    const acme = await newOrgOwner("Acme")
    const inv = await acme.client.call("/organization/invite-member", {
      email: "invited@example.test",
      role: "member",
    })
    const stranger = await newUser()
    const res = await stranger.client.call("/organization/accept-invitation", {
      invitationId: inv.data.id,
    })
    expect(res.status).toBe(403)
  })

  it("a removed member loses access immediately", async () => {
    const acme = await newOrgOwner("Acme")
    const member = await addMember(acme, "member")
    await acme.client.call("/organization/remove-member", { memberIdOrEmail: member.memberId })
    const res = await member.client.call(
      `/organization/get-full-organization?organizationId=${acme.orgId}`,
    )
    expect(res.status).toBe(403)
  })
})
