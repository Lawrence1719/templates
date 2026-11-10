import { auth } from "@templates/auth"
import { requireOrg } from "@templates/auth/guards"
import { allowedHrefs } from "@templates/shell/server"
import { headers } from "next/headers"

import { Shell } from "@/components/shell"
import { nav } from "@/config/nav"

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { user, orgId } = await requireOrg()
  const [orgs, allowed] = await Promise.all([
    auth.api.listOrganizations({ headers: await headers() }),
    allowedHrefs(nav),
  ])

  return (
    <Shell
      allowed={allowed}
      user={{ name: user.name, email: user.email, image: user.image }}
      orgs={orgs.map((o) => ({ id: o.id, name: o.name }))}
      activeOrgId={orgId}
    >
      {children}
    </Shell>
  )
}
