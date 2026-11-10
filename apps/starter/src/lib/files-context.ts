import "server-only"

import { can, getSession } from "@templates/auth/guards"
import type { Permissions } from "@templates/auth/permissions"
import type { FilesContext } from "@templates/files"

/**
 * Builds the files context from the session for API routes.
 * Returns a JSON error response instead of redirecting (these are API calls).
 */
export async function filesContext(
  permission: Permissions,
): Promise<{ ctx: FilesContext; error?: never } | { ctx?: never; error: Response }> {
  const session = await getSession()
  const orgId = session?.session.activeOrganizationId
  if (!session || !orgId)
    return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) }
  const [allowed, canDeleteAny] = await Promise.all([can(permission), can({ file: ["delete"] })])
  if (!allowed) return { error: Response.json({ error: "Forbidden" }, { status: 403 }) }
  const { id, name, email } = session.user
  return { ctx: { orgId, user: { id, name, email }, canDeleteAny } }
}
