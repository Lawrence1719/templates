import { db } from "@templates/db"
import { notification } from "@templates/db/schema"
import {
  devOutbox,
  getPreferences,
  listNotifications,
  markRead,
  notify,
  renderEmail,
  setPreference,
  unreadCount,
} from "@templates/notifications"
import { eq } from "drizzle-orm"
import { beforeEach, describe, expect, it } from "vitest"

import { addMember, newOrgOwner, newUser } from "../setup/client"

const inbox = (userId: string, orgId: string) =>
  listNotifications({ userId, orgId }, { limit: 100 })
const emailsTo = (email: string) => devOutbox.filter((e) => e.to === email)

beforeEach(() => {
  devOutbox.length = 0
})

describe("invitation email", () => {
  it("emails the invitee an accept link", async () => {
    const org = await newOrgOwner("Acme")
    const inv = await org.client.call("/organization/invite-member", {
      email: "guest@example.test",
      role: "admin",
    })
    const [mail] = emailsTo("guest@example.test")
    expect(mail?.subject).toContain("invited you to Acme")
    expect(mail?.text).toContain(`http://localhost:3000/accept-invite/${inv.data.id}`)
    expect(mail?.html).toContain(`/accept-invite/${inv.data.id}`)
  })

  it("escapes names typed by users", async () => {
    const org = await newOrgOwner("Acme")
    await org.client.call("/organization/update", {
      data: { name: `<img src=x onerror=alert(1)>` },
    })
    await org.client.call("/organization/invite-member", {
      email: "victim@example.test",
      role: "member",
    })
    const [mail] = emailsTo("victim@example.test")
    expect(mail?.html).not.toContain("<img")
    expect(mail?.html).toContain("&lt;img src=x onerror=alert(1)&gt;")
  })
})

describe("member notifications", () => {
  it("tells owners and admins when someone joins, not the joiner or other members", async () => {
    const org = await newOrgOwner("Acme")
    const admin = await addMember(org, "admin")
    const member = await addMember(org, "member")
    const joiner = await addMember(org, "member")

    const titles = async (id: string) => (await inbox(id, org.orgId)).map((n) => n.title)
    expect(await titles(org.id)).toContain(`${joiner.name} joined Acme`)
    expect(await titles(admin.id)).toContain(`${joiner.name} joined Acme`)
    expect(await titles(member.id)).not.toContain(`${joiner.name} joined Acme`)
    expect(await titles(joiner.id)).toEqual([])
  })

  it("notifies a member in-app and by email when their role changes", async () => {
    const org = await newOrgOwner("Acme")
    const member = await addMember(org, "member")
    devOutbox.length = 0 // ignore the invitation email
    await org.client.call("/organization/update-member-role", {
      memberId: member.memberId,
      role: "admin",
    })

    const [n] = await inbox(member.id, org.orgId)
    expect(n?.type).toBe("member.role_changed")
    expect(n?.title).toBe("Your role in Acme is now admin")
    expect(emailsTo(member.email)).toHaveLength(1)
  })

  it("respects a user's preferences", async () => {
    const org = await newOrgOwner("Acme")
    const member = await addMember(org, "member")
    await setPreference(member.id, "member.role_changed", { inApp: true, email: false })
    devOutbox.length = 0
    await org.client.call("/organization/update-member-role", {
      memberId: member.memberId,
      role: "admin",
    })

    expect(await inbox(member.id, org.orgId)).toHaveLength(1)
    expect(emailsTo(member.email)).toHaveLength(0)
  })

  it("emails a removed member but leaves no in-app notification they can't reach", async () => {
    const org = await newOrgOwner("Acme")
    const member = await addMember(org, "member")
    devOutbox.length = 0
    await org.client.call("/organization/remove-member", { memberIdOrEmail: member.memberId })

    expect(emailsTo(member.email).map((e) => e.subject)).toEqual(["You were removed from Acme"])
    const rows = await db.select().from(notification).where(eq(notification.userId, member.id))
    expect(rows).toHaveLength(0)
  })
})

describe("notify()", () => {
  it("skips recipients who aren't members of the organization", async () => {
    const acme = await newOrgOwner("Acme")
    const outsider = await newOrgOwner("Other")
    const sent = await notify({
      orgId: acme.orgId,
      to: [acme.id, outsider.id],
      type: "member.role_changed",
      title: "Hello",
    })
    expect(sent.inApp).toBe(1)
    expect(await inbox(outsider.id, acme.orgId)).toHaveLength(0)
    expect(emailsTo(outsider.email)).toHaveLength(0)
  })

  it("drops links that leave the app", async () => {
    const org = await newOrgOwner("Acme")
    for (const link of ["https://evil.example", "//evil.example", "javascript:alert(1)"]) {
      await notify({
        orgId: org.orgId,
        to: [org.id],
        type: "member.role_changed",
        title: link,
        link,
      })
    }
    for (const n of await inbox(org.id, org.orgId)) expect(n.link).toBeNull()
    for (const e of emailsTo(org.email)) expect(e.html).not.toContain('evil.example" ')
  })

  it("never throws", async () => {
    await expect(
      notify({
        orgId: "00000000-0000-0000-0000-000000000000",
        to: ["not-a-uuid"],
        type: "member.joined",
        title: "x",
      }),
    ).resolves.toEqual({ inApp: 0, email: 0 })
  })
})

describe("inbox", () => {
  it("only shows and changes the owner's own notifications", async () => {
    const org = await newOrgOwner("Acme")
    const other = await addMember(org, "member")
    const owner = { userId: org.id, orgId: org.orgId }
    await markRead(owner, "all") // clear the "joined" notification from setup
    await notify({
      orgId: org.orgId,
      to: [org.id],
      type: "member.role_changed",
      title: "For the owner",
    })
    const [mine] = await inbox(org.id, org.orgId)
    expect(mine?.title).toBe("For the owner")

    // Another member tries to mark it read by ID.
    expect(await markRead({ userId: other.id, orgId: org.orgId }, [mine?.id ?? ""])).toBe(0)
    expect(await unreadCount(owner)).toBe(1)
    expect(await inbox(other.id, org.orgId)).not.toContainEqual(
      expect.objectContaining({ id: mine?.id }),
    )
  })

  it("keeps each organization's notifications separate for the same user", async () => {
    const a = await newOrgOwner("Alpha")
    const b = await newOrgOwner("Beta")
    // Owner of A joins B as a member.
    const inv = await b.client.call("/organization/invite-member", {
      email: a.email,
      role: "member",
    })
    await a.client.call("/organization/accept-invitation", { invitationId: inv.data.id })

    await notify({ orgId: b.orgId, to: [a.id], type: "member.role_changed", title: "From Beta" })
    expect((await inbox(a.id, a.orgId)).map((n) => n.title)).not.toContain("From Beta")
    expect((await inbox(a.id, b.orgId)).map((n) => n.title)).toContain("From Beta")
  })

  it("marks all read", async () => {
    const org = await newOrgOwner("Acme")
    for (const t of ["one", "two", "three"])
      await notify({ orgId: org.orgId, to: [org.id], type: "member.role_changed", title: t })
    expect(await unreadCount({ userId: org.id, orgId: org.orgId })).toBe(3)
    expect(await markRead({ userId: org.id, orgId: org.orgId }, "all")).toBe(3)
    expect(await unreadCount({ userId: org.id, orgId: org.orgId })).toBe(0)
  })
})

describe("preferences", () => {
  it("starts from each type's defaults", async () => {
    const { id } = await newUser()
    const prefs = Object.fromEntries((await getPreferences(id)).map((p) => [p.type, p.channels]))
    expect(prefs["member.role_changed"]).toEqual({ inApp: true, email: true })
    expect(prefs["member.joined"]).toEqual({ inApp: true, email: false })
  })

  it("rejects unknown types and required types", async () => {
    const { id } = await newUser()
    await expect(setPreference(id, "made.up", { inApp: false, email: false })).rejects.toThrow(
      /Unknown/,
    )
    await expect(
      setPreference(id, "member.removed", { inApp: false, email: false }),
    ).rejects.toThrow(/can't be turned off/)
  })
})

describe("email rendering", () => {
  it("escapes all text and only allows absolute http(s) action links", () => {
    const e = renderEmail({ subject: "s", heading: `"><script>x</script>`, paragraphs: ["a & b"] })
    expect(e.html).not.toContain("<script>")
    expect(e.html).toContain("a &amp; b")
    expect(() =>
      renderEmail({
        subject: "s",
        heading: "h",
        paragraphs: [],
        action: { label: "Go", url: "javascript:alert(1)" },
      }),
    ).toThrow()
  })
})
