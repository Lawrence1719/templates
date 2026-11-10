# templates

Reusable modules for building business systems — auth, roles, dashboards, CRM, inventory and more — on a typed, secure, portable stack.

> Work in progress. Modules ship one at a time, each with its own docs.

## Stack

Next.js · TypeScript · Postgres · Drizzle ORM · Better Auth · Tailwind + shadcn/ui · Turborepo + pnpm

## Structure

```
apps/starter      demo app with the modules installed
packages/config   shared TypeScript config
packages/db       Drizzle client and schema (each module adds its tables)
```

## Quickstart

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm dev
```

## Modules

| Module              | Status  |
| ------------------- | ------- |
| Auth, roles & teams | next    |
| App shell           | planned |
| Audit log           | planned |
| Dashboard & reports | planned |
| Notifications       | planned |
| Files               | planned |
| Forms               | planned |

## License

MIT
