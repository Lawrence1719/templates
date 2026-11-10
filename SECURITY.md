# Security

## Model

- **No direct database access from the browser.** Credentials live only on the server.
- **Every request is checked on the server**: session → active organization → role permission, via the guards in `@templates/auth/guards`. Client-side checks only hide UI.
- **Tenant isolation**: all tenant data carries `org_id`, and server code filters by the `orgId` from the session — never from request input.
- **Input validation** with Zod; queries are parameterized by Drizzle.
- **Auth**: hashed passwords, httpOnly + SameSite cookies, origin checks, rate-limited sign-in/up, expiring single-use invitations.
- **Audit trail**: organization changes are written to an append-only `audit_log`; a database trigger rejects updates and deletes, so history can't be rewritten even by app code.
- **Secrets** are validated at startup and never committed (`.env` is ignored; see `.env.example`).

## Verified

| Check                                         | Expected       | Result |
| --------------------------------------------- | -------------- | ------ |
| Member invites a user                         | 403            | ✓      |
| Member deletes the organization               | 403            | ✓      |
| Non-member reads another organization         | 403            | ✓      |
| Non-member switches into another organization | 403            | ✓      |
| 6 failed sign-ins within a minute             | 429 on the 6th | ✓      |

These, and more, run automatically in [`tests/`](tests) on every push (see CI):

| Area    | What's tested                                                                                                                         |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Auth    | sign-up/out, wrong password, password length, no hash in responses, sign-in rate limit                                                |
| CSRF    | signed-in requests from a foreign or missing origin are rejected                                                                      |
| Tenancy | non-members can't read, switch into, or invite into another org; invites only work for the invited email; removed members lose access |
| Roles   | members can't manage anything; admins manage people but can't delete the org; per-permission matrix                                   |
| Audit   | right actor per event, IP captured, UPDATE/DELETE rejected, org-scoped queries and exports, LIKE escaping, CSV formula neutralization |

**Note:** Better Auth disables its origin check when `NODE_ENV=test`. This project sets `disableOriginCheck: false` explicitly so the protection is always on — and tested.

## Reporting

Please report vulnerabilities privately via GitHub security advisories rather than public issues.
