# Scheduling & bookings

Services, the people or rooms who provide them, weekly hours and time off, a staff agenda, and a public booking page customers can use without an account. Double booking is impossible: the database refuses it.

## Features

- **Services** with length, a gap after (clean-up or travel), price, and who can do them
- **People and rooms** with weekly hours (several ranges a day) in the business's time zone, plus **time off**
- **Slots** worked out from hours, existing bookings (with their gaps), time off, minimum notice and how far ahead people can book, correct across daylight-saving changes
- **Staff agenda**: a week at a time, filter by person, today / next 7 days / waiting-for-approval counts; book for walk-ins or existing CRM customers
- **Statuses**: waiting for approval → confirmed → completed or no-show, or cancelled (with a reason)
- **Public booking page** at `/book/<link>`: pick a service, a person or "anyone", a day and a time, then enter details. Only free times are shown, never other bookings
- **Customer link** at `/book/manage/<token>` to view or cancel, until a cutoff you set
- **Emails** to the customer (request received, confirmed, cancelled) and **notifications** to the person booked (`booking.created`, `booking.cancelled`)
- **Settings**: time zone, slot step, notice, horizon, cancel cutoff, approve-first, online on/off, and a "make a new link" button

## Integrity and security

| Risk                              | Defense                                                                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Double booking                    | A Postgres exclusion constraint (`btree_gist`) refuses two active bookings for the same person or room whose times overlap, buffer included. Tests fire 8 requests at one slot: exactly one wins |
| Booking times nobody offered      | Online bookings are checked against live availability on the server; any time not offered is refused                                                                                             |
| Wrong times around clock changes  | Hours are wall-clock times in the business's zone, converted per day; times skipped by a spring-forward change are never offered (tested with New York's DST dates)                              |
| Bots and flooding                 | Hidden honeypot field; 10 online bookings per IP per hour, IPs stored only as salted hashes                                                                                                      |
| Leaking other customers' bookings | The public page and slot API return services, names of who can be booked, and free times; nothing about other bookings                                                                           |
| Guessing links                    | The public link is random and can be replaced anytime; customer links are 144-bit; both are `noindex` and `no-referrer`; bad links are 404                                                       |
| Other organizations' data         | Every query filters by the session's org; hours, time off and bookings use composite `(…, org_id)` foreign keys; services can only list your own people                                          |
| Who can change setup              | Members book, confirm and cancel; services, hours and settings need `booking: manage`                                                                                                            |

## Permissions

`booking: ["read", "write", "manage"]`.

## Use the pieces

```ts
import { computeSlots, formatTime, zonedToUtc } from "@templates/bookings/definitions" // browser-safe
import { availability, bookOnline, createBooking } from "@templates/bookings" // server

const { slots } = await availability(orgId, { serviceId, resourceId: null, day: "2027-03-03" })
await createBooking(ctx, {
  serviceId,
  resourceId,
  startsAt: slots[0].startsAt.toISOString(),
  customerName: "Dana",
})
```

## Make it yours

- **Take deposits**: create a Stripe Checkout session after `bookOnline` and confirm the booking from the webhook (use `requireApproval` until paid).
- **Reminders**: run a job every hour that finds confirmed bookings starting in 24 hours and emails the manage link.
- **Rescheduling**: add a "change time" step to the manage page that books the new slot and cancels the old one in one transaction.
- **Classes and group sessions**: add a capacity to services and count bookings per slot instead of using the exclusion constraint.
- **Invoices**: when a booking is completed, create a draft invoice with the Invoicing module.

## Setup

`pnpm --filter @templates/db db:migrate` creates the booking tables and the `btree_gist` extension (a trusted extension; the database owner can install it). It needs the Auth, Audit log and Notifications modules, and the CRM for linking customers.
