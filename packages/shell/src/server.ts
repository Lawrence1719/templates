import "server-only"

import { can } from "@templates/auth/guards"

import type { NavGroup } from "./types"

/**
 * Returns the hrefs the current user may see. Pass the result to <AppShell allowed>.
 * (Icons can't cross the server→client boundary, so we send hrefs, not items.)
 */
export async function allowedHrefs(groups: NavGroup[]): Promise<string[]> {
  const items = groups.flatMap((g) => g.items)
  const checks = await Promise.all(
    items.map(async (i) => (!i.permission || (await can(i.permission)) ? i.href : null)),
  )
  return checks.filter((h) => h !== null)
}
