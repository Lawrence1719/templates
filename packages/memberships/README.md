# Memberships

Plans, sign-ups, renewals and a front-desk check-in for gyms, studios, clubs and coffee subscriptions. Members are CRM customers; each one gets a card code they can show from their phone.

## Features

- **Plans**: a price per period (days, weeks, months or years), with unlimited visits or a limit per period (class packs)
- **Sign-ups** with payment recorded as cash, card, other, free, or a draft invoice from the Invoicing module
- **Renewals** that start the day after the period ends, or today if it lapsed. Price changes apply from each member's next renewal
- **Pause and resume**: the paused days are added back to the end date
- **Cancel**, with a reason, and a full history of who did what
- **Check-in desk**: scan or type a card code (spaces, dashes and case don't matter), or search by name. Clear green and red results; the field refocuses for the next scan
- **Today's visits**, with undo for mistakes
- **Member card page** at `/m/<code>`: name, plan, status, visits left and the code to show at the desk. No account needed
- **Emails** to members: welcome with the card link, the card link on request, and a renewal reminder before the end date
- **Scheduled job** at `/api/cron/memberships`: renews auto-renew memberships with a draft invoice, and sends reminders

## Integrity and security

| Risk                          | Defense                                                                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Getting in when you shouldn't | Check-ins refuse cancelled, paused, expired and not-yet-started memberships, and visits past the plan's limit                                                                                           |
| Double scans and shared cards | A second check-in within the cooldown (60 minutes by default) is refused. Check-ins run under a row lock: four scans at once on a 2-visit pack let in exactly two                                       |
| Renewing twice                | Each renewal names the period end it saw; a second click or a second person gets "already renewed". Three at once: one renewal                                                                          |
| Guessing card codes           | 24 characters from a 32-letter alphabet (~119 bits). Lost cards can be replaced; the old code stops working at once. Card pages are `noindex` and `no-referrer`, and show only that member's own status |
| Rewriting what happened       | Triggers make paid periods and history append-only, let a check-in be voided once but never edited or deleted, and make cancelled memberships final                                                     |
| Undoing visits                | Staff can undo their own check-ins for 15 minutes; after that, only managers                                                                                                                            |
| Abusing the scheduled job     | It needs `Authorization: Bearer $CRON_SECRET` (compared in constant time) and is off until the secret is set. Running it twice changes nothing more                                                     |
| Other organizations' data     | Every query filters by the session's org, card lookups included; memberships, periods, check-ins and history use composite `(…, org_id)` foreign keys                                                   |

## Permissions

`membership: ["read", "checkin", "sell", "manage"]`. Members check people in, sign them up, renew and pause. Plans, settings, cancelling and undoing older check-ins are for admins.

## Use the pieces

```ts
import { formatCardCode, periodEndFor } from "@templates/memberships/definitions" // browser-safe
import { checkIn, renewMembership, startMembership } from "@templates/memberships" // server

const m = await startMembership(ctx, {
  customerId,
  planId,
  startDay: "2027-01-04",
  paidVia: "card",
})
const r = await checkIn(ctx, { code: formatCardCode(m.cardToken) })
if (!r.ok) console.log(r.reason) // "Already checked in at 9:02."
```

## Make it yours

- **Card payments online**: create a Stripe Checkout session for renewals and call `renewMembership` from the webhook.
- **QR codes**: render the card code as a QR on the card page so scanners can read it from a phone.
- **Family plans**: let one membership list several customers and check in any of them.
- **Freeze limits**: cap how many days a year a membership can be paused.
- **Class booking**: pair class packs with the Bookings module so each class takes a visit.

## Setup

1. `pnpm --filter @templates/db db:migrate` creates the tables and triggers. It needs the Auth, Audit log, Notifications, CRM and Invoicing modules.
2. Set `CRON_SECRET` and call `GET /api/cron/memberships` hourly with `Authorization: Bearer $CRON_SECRET` (Vercel Cron, GitHub Actions or plain cron).
