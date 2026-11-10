import "server-only"

import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { auth } from "./index"
import type { Permissions } from "./permissions"

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
  ) {
    super(message)
  }
}

/** Current session or null. Never trust anything from the client instead of this. */
export async function getSession() {
  return auth.api.getSession({ headers: await headers() })
}

/** For pages: signed-in user or redirect to sign-in. */
export async function requireUser() {
  const session = await getSession()
  if (!session) redirect("/sign-in")
  return session
}

/**
 * For pages: signed-in user with an active organization.
 * Returns `orgId` — every tenant query must filter by it.
 */
export async function requireOrg() {
  const session = await requireUser()
  const orgId = session.session.activeOrganizationId
  if (!orgId) redirect("/onboarding")
  return { ...session, orgId }
}

/** Throws 403 unless the user's role in the active org grants these permissions. */
export async function requirePermission(permissions: Permissions) {
  const ctx = await requireOrg()
  const { success } = await auth.api.hasPermission({
    headers: await headers(),
    body: { permissions },
  })
  if (!success) throw new AuthError("Forbidden", 403)
  return ctx
}

type OrgContext = Awaited<ReturnType<typeof requireOrg>>

/**
 * The one path to tenant data from server actions.
 * Checks session, active org and permission before the handler runs.
 *
 *   export const archiveCustomer = protectedAction(
 *     { permission: { customer: ["write"] } },
 *     async (ctx, id: string) => db.update(customers)...where(and(eq(customers.orgId, ctx.orgId), ...))
 *   )
 */
export function protectedAction<Args extends unknown[], R>(
  opts: { permission?: Permissions },
  handler: (ctx: OrgContext, ...args: Args) => Promise<R>,
) {
  return async (...args: Args): Promise<R> => {
    const ctx = opts.permission ? await requirePermission(opts.permission) : await requireOrg()
    return handler(ctx, ...args)
  }
}
