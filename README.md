# templates

[![CI](https://github.com/Lawrence1719/templates/actions/workflows/ci.yml/badge.svg)](https://github.com/Lawrence1719/templates/actions/workflows/ci.yml)

Reusable modules for building business systems — auth, roles, dashboards, CRM, inventory and more — on a typed, secure, portable stack.

> Work in progress. Modules ship one at a time, each with its own docs.

## Stack

Next.js · TypeScript · Postgres · Drizzle ORM · Better Auth · Tailwind + shadcn/ui · Turborepo + pnpm

## Structure

```
apps/starter      demo app with the modules installed
tests             integration tests (real Postgres, real auth handler)
packages/config   shared TypeScript config
packages/db       Drizzle client, schema and migrations
packages/auth     Auth, roles & teams module
packages/shell    App shell module (sidebar, top bar, theme, ⌘K)
packages/ui       Shared components and design tokens
packages/audit    Audit log module (append-only, searchable, CSV export)
packages/reports  Dashboard & reports module (KPI tiles, trends, breakdowns)
packages/notifications  In-app + email notifications with preferences
packages/files    Uploads with type checking, S3 or local storage
packages/forms    Form builder, public share links, responses
packages/crm      Customers, contacts, deals pipeline, timeline
packages/tasks    Tasks, projects board, checklists, repeating work
packages/invoicing  Quotes, invoices, payments, customer links
packages/inventory  Products, locations, stock ledger, reorder alerts
packages/orders   Sales orders: confirm, fulfill from stock, invoice
packages/bookings  Services, hours, slots, public booking page
```

## Quickstart

```bash
cp .env.example .env   # then set BETTER_AUTH_SECRET
docker compose up -d
pnpm install
pnpm --filter @templates/db db:migrate
# optional: 90 days of demo data for a user you signed up with
pnpm --filter @templates/starter seed:demo -- you@example.com
pnpm dev
```

## Tests

```bash
docker compose up -d
pnpm test
```

266 integration tests run against a throwaway Postgres database and the real auth handler — no mocked database. They cover sign-in and rate limiting, cross-site request protection, tenant isolation, every role's permissions, the audit log (correct actor, tamper resistance, org scoping, CSV safety), dashboard metrics (day bucketing, period comparison, org scoping), notifications (right recipients, preferences, inbox isolation, email escaping), files (type detection, name sanitizing, org isolation, delete rights), forms (validation, spam protection, members-only access, org isolation), the CRM (search, pipeline moves, money parsing, owner checks, database-level tenant links), tasks (repeat rules, due buckets, delete rights, comment notifications), invoicing (exact money math, gap-free numbering under concurrency, no overpayment, database-locked sent invoices), inventory (no overselling under concurrency, deadlock-free transfers, append-only stock ledger), orders (all-or-nothing fulfillment from stock, locked finished orders, append-only history), and bookings (no double booking under concurrency, daylight-saving-safe slots, bot and rate limits). CI runs lint, typecheck, tests and build on every push.

## Modules

All seven core modules are done; business modules are shipping now. Everything is MIT-licensed. Each module has its own README with features, setup and security notes.

### Core

| Module                                  | What it gives you                                                            | Status  |
| --------------------------------------- | ---------------------------------------------------------------------------- | ------- |
| [Auth, roles & teams](packages/auth)    | Sign-in, organizations, invitations, owner/admin/member roles, server guards | ✅ v0.1 |
| [App shell](packages/shell)             | Sidebar, top bar, org switcher, theme, ⌘K command palette                    | ✅ v0.1 |
| [Audit log](packages/audit)             | Append-only history, search, filters, CSV export                             | ✅ v0.1 |
| [Dashboard & reports](packages/reports) | KPI tiles, trend charts, breakdowns, date ranges                             | ✅ v0.1 |
| [Notifications](packages/notifications) | In-app bell, inbox, email, per-user preferences                              | ✅ v0.1 |
| [Files](packages/files)                 | Uploads with type checking, S3 or local storage                              | ✅ v0.1 |
| [Forms](packages/forms)                 | Form builder, public share links, responses                                  | ✅ v0.1 |

### Business

| Module                                     | What it gives you                                                        | Status    |
| ------------------------------------------ | ------------------------------------------------------------------------ | --------- |
| [CRM](packages/crm)                        | Customers, contacts, deals pipeline, activity timeline, CSV export       | ✅ v0.1   |
| [Tasks & projects](packages/tasks)         | Assignments, checklists, due dates, repeating work, project boards       | ✅ v0.1   |
| [Invoicing & payments](packages/invoicing) | Quotes, invoices, payments, customer links, reminders                    | ✅ v0.1   |
| [Inventory](packages/inventory)            | Products, locations, stock ledger, transfers, counts, low-stock alerts   | ✅ v0.1   |
| [Orders & sales](packages/orders)          | Order workflow: confirm, fulfill from stock, invoice, full history       | ✅ v0.1   |
| [Scheduling & bookings](packages/bookings) | Services, hours, time off, slots, public booking page, no double booking | ✅ v0.1   |
| Point of sale                              | Cart, receipts, cash drawer, shift reports                               | 🔜 next   |
| Staff & HR                                 | Employee records, attendance, leave                                      | 🗓 planned |
| Memberships                                | Plans, renewals, member check-in                                         | 🗓 planned |

## License

MIT
