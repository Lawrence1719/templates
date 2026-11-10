# Audit log

A permanent, tamper-resistant record of who did what in each organization — with a searchable page and CSV export.

## Features

- **Append-only at the database level**: a Postgres trigger rejects every `UPDATE` and `DELETE`. Rows only disappear when their organization is deleted.
- **Automatic org events**: organization created/updated, invitations created/cancelled/declined, members joined/removed/left, role changes
- **One-line API** for your own modules: `audit(ctx, "customer.deleted", "Deleted Jane Doe")`
- **Captures** actor (with name/email snapshot that survives user deletion), target, metadata, IP and user agent
- **Audit log page**: search, filter by action / person / date range, pagination; filters live in the URL so views can be shared
- **CSV export**, itself logged, with formula-injection-safe cells
- **Permission-gated**: `audit: ["read"]` (owner and admin by default)
- **Never breaks the action**: a failed log write is reported, not thrown

## Table: `audit_log`

| Column                                  | Notes                                              |
| --------------------------------------- | -------------------------------------------------- |
| `org_id`                                | Tenant; every query filters by it                  |
| `actor_id`, `actor_name`, `actor_email` | Who. Snapshot kept if the user is deleted          |
| `action`                                | Dotted verb, e.g. `member.role_changed`            |
| `target_type`, `target_id`              | What it happened to                                |
| `summary`                               | One readable line for the UI                       |
| `metadata`                              | JSON details (capped at 8 KB)                      |
| `ip`, `user_agent`                      | Request info                                       |
| `created_at`                            | Indexed with `org_id` for fast newest-first paging |

## Usage

Log from any `protectedAction`:

```ts
import { audit } from "@templates/audit"

export const deleteCustomer = protectedAction(
  { permission: { customer: ["delete"] } },
  async (ctx, id: string) => {
    const [c] = await db
      .delete(customers)
      .where(and(eq(customers.orgId, ctx.orgId), eq(customers.id, id)))
      .returning()
    if (c)
      await audit(ctx, "customer.deleted", `Deleted ${c.name}`, {
        target: { type: "customer", id },
      })
  },
)
```

Outside a session (jobs, webhooks) use `recordAudit({ orgId, actor: null, action, summary })`.

Read it:

```ts
import { listAuditLog, auditFilterSchema } from "@templates/audit"

const { rows, total, pages } = await listAuditLog(
  orgId,
  auditFilterSchema.parse({ action: "member.removed" }),
)
```

## Naming actions

Use `<resource>.<past-tense verb>`: `invoice.sent`, `customer.updated`, `stock.adjusted`. Keep summaries human: _"Removed Jane Doe (jane@acme.com)"_.

## Setup

1. `pnpm --filter @templates/db db:migrate` (creates the table and the append-only trigger)
2. Add `audit: ["read"]` to the roles that may view it (`packages/auth/src/permissions.ts`)
3. Add the page and export route from `apps/starter/src/app/(app)/settings/audit-log`
