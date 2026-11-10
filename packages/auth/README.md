# Auth, roles & teams

Sign-up, sign-in, organizations, invitations and role-based permissions for multi-tenant business apps.

Built on [Better Auth](https://better-auth.com) with the organization plugin and a Drizzle (Postgres) adapter.

## Features

- Email + password auth (10+ char passwords, hashed), 7-day sessions in httpOnly cookies
- Organizations (tenants): create, switch, multiple per user
- Invitations by email with role, 48h expiry, accept / decline / cancel
- Roles: **owner**, **admin**, **member** — defined in one file, extendable per module
- Server guards so every page and action is checked before it touches data
- Rate limiting: 5 sign-ins / min, 3 sign-ups / min per IP

## Tables

| Table          | Purpose                                            |
| -------------- | -------------------------------------------------- |
| `user`         | People who can sign in                             |
| `session`      | Active sessions, incl. `active_organization_id`    |
| `account`      | Credentials (password hash) and future OAuth links |
| `verification` | Short-lived tokens (email verification, resets)    |
| `organization` | Tenants                                            |
| `member`       | User ↔ organization with a role                    |
| `invitation`   | Pending invites                                    |

## Roles

| Permission                       | owner | admin | member |
| -------------------------------- | :---: | :---: | :----: |
| Update organization              |   ✓   |   ✓   |        |
| Delete organization              |   ✓   |       |        |
| Invite / remove / change members |   ✓   |   ✓   |        |
| Billing: read                    |   ✓   |   ✓   |        |
| Billing: update                  |   ✓   |       |        |

Edit [`src/permissions.ts`](src/permissions.ts) to add resources. A module adds its own, e.g.:

```ts
export const statements = {
  ...defaultStatements,
  customer: ["read", "write", "delete"],
} as const
```

## Usage

**Pages** — redirect when not allowed:

```ts
import { requireOrg } from "@templates/auth/guards"

const { user, orgId } = await requireOrg() // signed in + has an active org
```

**Server actions** — the one path to tenant data:

```ts
import { protectedAction } from "@templates/auth/guards"

export const deleteCustomer = protectedAction(
  { permission: { customer: ["delete"] } },
  async ({ orgId }, id: string) =>
    db.delete(customers).where(and(eq(customers.orgId, orgId), eq(customers.id, id))),
)
```

**Client** — UI only; the server re-checks everything:

```ts
import { organization, signIn, useSession } from "@templates/auth/client"
```

## Setup

1. Set `BETTER_AUTH_SECRET` (`openssl rand -hex 32`) and `BETTER_AUTH_URL` in `.env`
2. `pnpm --filter @templates/db db:migrate`
3. Mount the handler at `app/api/auth/[...all]/route.ts`:

```ts
import { auth } from "@templates/auth"
import { toNextJsHandler } from "better-auth/next-js"

export const { GET, POST } = toNextJsHandler(auth)
```

## Not yet

- Invitation emails are logged to the console — real email arrives with the Notifications module
- Email verification, password reset, 2FA, OAuth providers
