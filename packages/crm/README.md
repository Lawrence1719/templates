# CRM

Customers, the people you talk to there, a deals pipeline and a timeline of every call, email, meeting and note. The first business module; invoicing, orders and bookings build on its customers.

## Features

- **Customers**: companies or people, with email, phone, website, address, status (lead → active → inactive), owner and tags
- **Search** across name, email, phone and contact names, plus filters for status, owner ("mine", "no owner", anyone) and tag; filters live in the URL so a view can be bookmarked
- **Contacts** per customer, with exactly one main contact kept automatically
- **Timeline**: log notes, calls, emails and meetings (past or planned); the module adds automatic entries when a customer is added, changes status or owner, or a deal moves
- **Deals** with value, currency, stage (new → qualified → proposal → won/lost), owner and expected close date; close dates are stamped and cleared when a deal is reopened
- **Pipeline board** at `/deals`: one column per stage with totals, "my deals" filter, overdue close dates flagged, and stage changes from a keyboard-friendly select
- **Files** attached to a customer, using the Files module
- **CSV export** of the filtered customer list (formula-safe)
- **Notifications**: `crm.assigned` when someone makes you the owner, `deal.won` to owners, admins and the deal owner
- **Audit**: customer, contact, deal and timeline changes are logged, with which fields changed

## Security

| Threat                                | Defense                                                                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reading or editing another org's data | Every query filters by the session's org; anything else is a 404                                                                                                                            |
| Linking records across orgs           | Contacts, deals and activity reference `(customer_id, org_id)` with a composite foreign key, so the database refuses a row that points at another org's customer even if app code has a bug |
| Assigning records to strangers        | An owner must be a member of the org                                                                                                                                                        |
| `javascript:` links                   | Only `http(s)` websites are stored; links open with `noopener noreferrer nofollow`                                                                                                          |
| Search tricks                         | `%` and `_` in searches are matched literally; queries are parameterized                                                                                                                    |
| Money rounding                        | Amounts are parsed from text into whole cents (`bigint`), never floats; different currencies are never added together                                                                       |
| Rewriting history                     | Automatic timeline entries can't be deleted; people delete only what they logged unless they're an admin                                                                                    |
| Spreadsheet formula injection         | CSV cells starting with `= + - @` are neutralized                                                                                                                                           |

## Permissions

`customer: ["read", "write", "delete"]`, `deal: ["read", "write", "delete"]`. Members read and work customers and deals; deleting them, and deleting other people's timeline entries, is for owners and admins.

## Use the pieces

```ts
import { customerInputSchema, fieldErrors, formatMoney } from "@templates/crm/definitions" // browser-safe
import { createCustomer, listCustomers, moveDeal } from "@templates/crm" // server

const ctx = { orgId, user } // from requirePermission({ customer: ["write"] })
const c = await createCustomer(ctx, { kind: "company", name: "Northwind", status: "lead" })
const { rows, total } = await listCustomers({ orgId }, { q: "north", tag: "vip" })
```

Service functions throw `CrmError` with a status and, for invalid input, `fieldErrors` keyed by field name, so forms can show messages next to each input. The starter's server actions in `app/actions/crm.ts` show the pattern.

## Make it yours

- **Stages**: edit `DEAL_STAGES` / `STAGE_LABELS` in `src/definitions.ts` and `DEAL_STAGES` in `packages/db/src/schema/crm.ts` (a test keeps the two in sync), then generate a migration.
- **Customer fields**: add a column in the schema, a field in `customerInputSchema`, and an input in `CustomerForm`.
- **Currencies**: extend `CURRENCIES`.
- **Who can do what**: change the `customer` and `deal` entries per role in `packages/auth/src/permissions.ts`.

## Setup

`pnpm --filter @templates/db db:migrate` — creates `customer`, `customer_contact`, `deal` and `crm_activity`. Requires the Auth, Audit log and Notifications modules; Files is optional.
