# Notifications

In-app notifications (bell + inbox) and email, with per-user preferences. Built-in events from the auth module; one call for your own.

## Features

- **Bell** in the top bar with unread count (polls every 60s while the tab is visible), dropdown of the latest 10, mark one or all read
- **Inbox page** (`/notifications`) with All / Unread filter
- **Preferences** (`/settings/notifications`): in-app and email toggles per type; "required" types can't be turned off
- **Email**: sends through [Resend](https://resend.com) when `RESEND_API_KEY` is set, otherwise prints to the console. Swap `sendEmail()` for any provider.
- **Safe email templates**: every user-supplied string is HTML-escaped; action links must be absolute http(s)
- **Built-in events**:
  - Invitation email with accept link
  - Someone joins → owners and admins
  - Your role changes → you
  - You're removed → you (email only, always on)
- **Never breaks the action**: a failed notification is logged, not thrown

## Tables

| Table                     | Purpose                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------- |
| `notification`            | One row per recipient: `org_id`, `user_id`, `type`, `title`, `body`, `link`, `read_at` |
| `notification_preference` | Per-user channel overrides per type (missing row = defaults)                           |

## Send one

1. Register the type in [`src/types.ts`](src/types.ts):

```ts
"invoice.overdue": {
  label: "An invoice becomes overdue",
  description: "Sent to the invoice owner.",
  defaults: { inApp: true, email: true },
},
```

2. Call `notify()` from your server code:

```ts
import { notify, membersWithRole } from "@templates/notifications"

await notify({
  orgId: ctx.orgId,
  to: [invoice.ownerId, ...(await membersWithRole(ctx.orgId, ["owner"]))],
  type: "invoice.overdue",
  title: `Invoice ${invoice.number} is overdue`,
  body: `${invoice.customerName} owes ${amount}.`,
  link: `/invoices/${invoice.id}`,
})
```

Recipients who aren't members of `orgId` are skipped. Links must be internal paths (`/…`); anything else is dropped.

## Security

Inbox functions take the session's `userId` **and** `orgId` and filter by both, so a user only sees and changes their own notifications in the organization they're working in. The starter's server actions read both from the session, never from the client.

## Setup

1. `pnpm --filter @templates/db db:migrate`
2. Optional: set `RESEND_API_KEY` and `EMAIL_FROM` in `.env`
3. Pass `<NotificationBell initialUnread={…} />` to the shell's `topbarActions` (see `apps/starter/src/app/(app)/layout.tsx`)
