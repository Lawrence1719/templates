import { auth } from "@templates/auth"
import { can, requireOrg } from "@templates/auth/guards"
import { Card, PageHeader } from "@templates/ui/card"
import type { Metadata } from "next"
import { headers } from "next/headers"

import { CancelInvite, InviteForm, MemberActions } from "@/components/org"
import { OrgNameForm } from "@/components/settings"

export const metadata: Metadata = { title: "Organization" }

export default async function OrganizationSettingsPage() {
  const { user, orgId } = await requireOrg()
  const [org, canManage, canEdit] = await Promise.all([
    auth.api.getFullOrganization({ headers: await headers(), query: { organizationId: orgId } }),
    can({ member: ["update"] }),
    can({ organization: ["update"] }),
  ])
  if (!org) return null
  const pending = org.invitations.filter((i) => i.status === "pending")

  return (
    <div className="grid gap-6">
      <PageHeader title="Organization" description="Name, members and invitations." />

      <Card className="max-w-xl">
        <OrgNameForm name={org.name} disabled={!canEdit} />
      </Card>

      <Card>
        <h2 className="font-semibold">Members ({org.members.length})</h2>
        <ul className="mt-4 divide-y">
          {org.members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div>
                <p className="text-sm font-medium">
                  {m.user.name} {m.userId === user.id && "(you)"}
                </p>
                <p className="text-sm text-muted-foreground">{m.user.email}</p>
              </div>
              <MemberActions
                memberId={m.id}
                role={m.role}
                canManage={canManage && m.userId !== user.id}
              />
            </li>
          ))}
        </ul>
      </Card>

      {canManage && (
        <Card className="grid gap-4">
          <h2 className="font-semibold">Invite people</h2>
          <InviteForm />
          {pending.length > 0 && (
            <ul className="divide-y">
              {pending.map((i) => (
                <li key={i.id} className="flex items-center justify-between py-2 text-sm">
                  <span>
                    {i.email} · <span className="capitalize">{i.role}</span>
                  </span>
                  <CancelInvite id={i.id} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  )
}
