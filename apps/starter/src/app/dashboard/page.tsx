import { auth } from "@templates/auth"
import { requireOrg } from "@templates/auth/guards"
import { headers } from "next/headers"

import {
  CancelInvite,
  InviteForm,
  MemberActions,
  OrgSwitcher,
  SignOutButton,
} from "@/components/org"
import { Card } from "@/components/ui"

export default async function DashboardPage() {
  const { user, orgId } = await requireOrg()
  const h = await headers()

  const [org, orgs, canManage] = await Promise.all([
    auth.api.getFullOrganization({ headers: h, query: { organizationId: orgId } }),
    auth.api.listOrganizations({ headers: h }),
    auth.api
      .hasPermission({ headers: h, body: { permissions: { member: ["update"] } } })
      .then((r) => r.success),
  ])
  if (!org) return null

  const me = org.members.find((m) => m.userId === user.id)
  const pending = org.invitations.filter((i) => i.status === "pending")

  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between gap-4 border-b border-neutral-200 px-6 py-3 dark:border-neutral-800">
        <OrgSwitcher orgs={orgs.map((o) => ({ id: o.id, name: o.name }))} activeId={orgId} />
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-neutral-500 sm:inline">{user.email}</span>
          <SignOutButton />
        </div>
      </header>

      <main className="mx-auto grid max-w-3xl gap-6 px-6 py-10">
        <div>
          <h1 className="text-2xl font-semibold">{org.name}</h1>
          <p className="text-sm text-neutral-500">
            You are <span className="capitalize">{me?.role}</span> of this organization.
          </p>
        </div>

        <Card>
          <h2 className="font-semibold">Members ({org.members.length})</h2>
          <ul className="mt-4 divide-y divide-neutral-200 dark:divide-neutral-800">
            {org.members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="text-sm font-medium">
                    {m.user.name} {m.userId === user.id && "(you)"}
                  </p>
                  <p className="text-sm text-neutral-500">{m.user.email}</p>
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
              <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
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
      </main>
    </div>
  )
}
