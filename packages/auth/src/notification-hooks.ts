import { appUrl, membersWithRole, notify, renderEmail, sendEmail } from "@templates/notifications"
import type { OrganizationOptions } from "better-auth/plugins"

type Hooks = NonNullable<OrganizationOptions["organizationHooks"]>
type InviteData = Parameters<NonNullable<OrganizationOptions["sendInvitationEmail"]>>[0]

/** The invitation email (the invitee may not have an account yet). */
export async function sendInvitationEmail({ email, organization, inviter, id, role }: InviteData) {
  await sendEmail({
    to: email,
    ...renderEmail({
      subject: `${inviter.user.name} invited you to ${organization.name}`,
      heading: `Join ${organization.name}`,
      paragraphs: [
        `${inviter.user.name} (${inviter.user.email}) invited you to join ${organization.name} as ${role}.`,
        "The invitation expires in 48 hours.",
      ],
      action: { label: "Accept invitation", url: appUrl(`/accept-invite/${id}`) },
      footer: "If you weren't expecting this, you can ignore this email.",
    }),
  })
}

/** Notifications triggered by organization changes. */
export const notificationHooks: Hooks = {
  async afterAcceptInvitation({ member, user, organization }) {
    const admins = await membersWithRole(organization.id, ["owner", "admin"])
    await notify({
      orgId: organization.id,
      to: admins.filter((id) => id !== user.id),
      type: "member.joined",
      title: `${user.name} joined ${organization.name}`,
      body: `They joined as ${member.role}.`,
      link: "/settings/organization",
    })
  },
  async afterUpdateMemberRole({ member, previousRole, user, organization }) {
    if (member.role === previousRole) return
    await notify({
      orgId: organization.id,
      to: [user.id],
      type: "member.role_changed",
      title: `Your role in ${organization.name} is now ${member.role}`,
      body: `It was ${previousRole}.`,
      link: "/dashboard",
    })
  },
  async afterRemoveMember({ user, organization }) {
    await notify({
      orgId: organization.id,
      to: [user.id],
      type: "member.removed",
      title: `You were removed from ${organization.name}`,
      body: "You no longer have access to this organization. Contact an owner if this was a mistake.",
      allowNonMembers: true,
    })
  },
}

/** Runs each hook from every set, in order. */
export function combineHooks(...sets: Hooks[]): Hooks {
  const out: Record<string, (data: never) => Promise<void>> = {}
  for (const set of sets)
    for (const [name, fn] of Object.entries(set) as [string, (data: never) => Promise<void>][]) {
      const prev = out[name]
      out[name] = prev
        ? async (data) => {
            await prev(data)
            await fn(data)
          }
        : fn
    }
  return out as Hooks
}
