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

59 integration tests run against a throwaway Postgres database and the real auth handler — no mocked database. They cover sign-in and rate limiting, cross-site request protection, tenant isolation, every role's permissions, the audit log (correct actor, tamper resistance, org scoping, CSV safety), dashboard metrics (day bucketing, period comparison, org scoping), and notifications (right recipients, preferences, inbox isolation, email escaping). CI runs lint, typecheck, tests and build on every push.

## Modules

| Module                                  | Status  |
| --------------------------------------- | ------- |
| Auth, roles & teams                     | next    |
| App shell                               | planned |
| Audit log                               | planned |
| [Dashboard & reports](packages/reports) | ✅ v0.1 |
| Notifications                           | planned |
| Files                                   | planned |
| Forms                                   | planned |

## License

MIT
