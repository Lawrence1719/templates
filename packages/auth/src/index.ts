import { db } from "@templates/db"
import * as schema from "@templates/db/schema"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { nextCookies } from "better-auth/next-js"
import { organization } from "better-auth/plugins"

import { auditHooks, type GetSession } from "./audit-hooks"
import { env } from "./env"
import { ac, roles } from "./permissions"

// Defined before `auth` so its type doesn't depend on itself; only called at request time.
const getSessionLazy: GetSession = (h) => auth.api.getSession({ headers: h })

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh daily while active
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60, max: 3 },
    },
  },
  advanced: {
    database: { generateId: "uuid" },
  },
  plugins: [
    organization({
      ac,
      roles,
      creatorRole: "owner",
      invitationExpiresIn: 60 * 60 * 48, // 48 hours
      // Every org change lands in the audit log.
      organizationHooks: auditHooks(getSessionLazy),
      async sendInvitationEmail({ email, organization, inviter, id }) {
        // Swapped for real email in the notifications module.
        const link = `${env.BETTER_AUTH_URL}/accept-invite/${id}`
        console.info(
          `[invite] ${inviter.user.email} invited ${email} to ${organization.name}: ${link}`,
        )
      },
    }),
    nextCookies(), // must stay last
  ],
})

export type Session = typeof auth.$Infer.Session
export { roles }
