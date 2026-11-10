import { recordAudit } from "@templates/audit"
import type { OrganizationOptions } from "better-auth/plugins"
import { headers } from "next/headers"

type Hooks = NonNullable<OrganizationOptions["organizationHooks"]>
type Actor = { id: string; name: string; email: string } | null
export type GetSession = (h: Headers) => Promise<{ user: Actor & object } | null>

/**
 * Logs every organization change to the audit log.
 * Some hooks only describe the affected member, so the actor
 * is read from the current request's session.
 */
export function auditHooks(getSession: GetSession): Hooks {
  async function actor(): Promise<Actor> {
    try {
      const s = await getSession(await headers())
      return s ? { id: s.user.id, name: s.user.name, email: s.user.email } : null
    } catch {
      return null
    }
  }

  return {
    async afterCreateOrganization({ organization, user }) {
      await recordAudit({
        orgId: organization.id,
        actor: user,
        action: "organization.created",
        target: { type: "organization", id: organization.id },
        summary: `Created organization ${organization.name}`,
      })
    },
    async afterUpdateOrganization({ organization }) {
      if (!organization) return
      await recordAudit({
        orgId: organization.id,
        actor: await actor(),
        action: "organization.updated",
        target: { type: "organization", id: organization.id },
        summary: `Updated organization settings (name: ${organization.name})`,
        metadata: { name: organization.name },
      })
    },
    async afterCreateInvitation({ invitation, inviter, organization }) {
      await recordAudit({
        orgId: organization.id,
        actor: inviter,
        action: "invitation.created",
        target: { type: "invitation", id: invitation.id },
        summary: `Invited ${invitation.email} as ${invitation.role}`,
        metadata: { email: invitation.email, role: invitation.role },
      })
    },
    async afterCancelInvitation({ invitation, cancelledBy, organization }) {
      await recordAudit({
        orgId: organization.id,
        actor: cancelledBy,
        action: "invitation.cancelled",
        target: { type: "invitation", id: invitation.id },
        summary: `Cancelled the invitation for ${invitation.email}`,
        metadata: { email: invitation.email },
      })
    },
    async afterAcceptInvitation({ invitation, member, user, organization }) {
      await recordAudit({
        orgId: organization.id,
        actor: user,
        action: "member.joined",
        target: { type: "member", id: member.id },
        summary: `${user.name} joined as ${member.role}`,
        metadata: { invitationId: invitation.id, role: member.role },
      })
    },
    async afterRejectInvitation({ invitation, user, organization }) {
      await recordAudit({
        orgId: organization.id,
        actor: user,
        action: "invitation.declined",
        target: { type: "invitation", id: invitation.id },
        summary: `${user.email} declined the invitation`,
      })
    },
    async afterUpdateMemberRole({ member, previousRole, user, organization }) {
      await recordAudit({
        orgId: organization.id,
        actor: await actor(),
        action: "member.role_changed",
        target: { type: "member", id: member.id },
        summary: `Changed ${user.name}'s role from ${previousRole} to ${member.role}`,
        metadata: { userId: user.id, from: previousRole, to: member.role },
      })
    },
    async afterRemoveMember({ member, user, organization }) {
      const by = await actor()
      const left = by?.id === user.id
      await recordAudit({
        orgId: organization.id,
        actor: by,
        action: left ? "member.left" : "member.removed",
        target: { type: "member", id: member.id },
        summary: left
          ? `${user.name} left the organization`
          : `Removed ${user.name} (${user.email})`,
        metadata: { userId: user.id, email: user.email, role: member.role },
      })
    },
  }
}
