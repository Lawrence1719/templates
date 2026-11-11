# Security

## Model

- **No direct database access from the browser.** Credentials live only on the server.
- **Every request is checked on the server**: session → active organization → role permission, via the guards in `@templates/auth/guards`. Client-side checks only hide UI.
- **Tenant isolation**: all tenant data carries `org_id`, and server code filters by the `orgId` from the session — never from request input.
- **Input validation** with Zod; queries are parameterized by Drizzle.
- **Auth**: hashed passwords, httpOnly + SameSite cookies, origin checks, rate-limited sign-in/up, expiring single-use invitations.
- **Audit trail**: organization changes are written to an append-only `audit_log`; a database trigger rejects updates and deletes, so history can't be rewritten even by app code.
- **Notifications** are read and changed only by their recipient in the active org (both IDs come from the session). Emails escape every user-supplied string, and links that leave the app are dropped.
- **Files**: the type is detected from the bytes (HTML, SVG and executables are refused whatever they're named); storage keys are generated server-side, never from filenames; downloads are sent as attachments with `nosniff` and a sandboxing CSP, and only images/PDF may open inline.
- **Public forms** validate every answer server-side against the form definition (unknown keys rejected), use a honeypot and a per-IP rate limit, and store IPs only as salted hashes.
- **CRM** records reference their customer by `(customer_id, org_id)` with composite foreign keys, so the database itself refuses cross-org links; owners must be org members; only `http(s)` websites are stored; money is stored as integer cents.
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

| Area          | What's tested                                                                                                                                                                                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth          | sign-up/out, wrong password, password length, no hash in responses, sign-in rate limit                                                                                                                                                                                  |
| CSRF          | signed-in requests from a foreign or missing origin are rejected                                                                                                                                                                                                        |
| Tenancy       | non-members can't read, switch into, or invite into another org; invites only work for the invited email; removed members lose access                                                                                                                                   |
| Roles         | members can't manage anything; admins manage people but can't delete the org; per-permission matrix                                                                                                                                                                     |
| Audit         | right actor per event, IP captured, UPDATE/DELETE rejected, org-scoped queries and exports, LIKE escaping, CSV formula neutralization                                                                                                                                   |
| Notifications | only owners/admins hear about joins; preferences respected; non-members never notified; another user can't mark yours read; same user's orgs kept separate; HTML in names escaped in emails; off-site links dropped                                                     |
| Files         | disguised and dangerous types rejected; path-traversal names sanitized; text never served inline; other orgs get 404 on list/download/delete; members delete only their own files; bytes removed on delete                                                              |
| Forms         | invalid/extra answers rejected; drafts and closed forms refuse responses; honeypot drops bots; 6th submission per IP is 429; raw IPs never stored; members-only forms refuse guests and outsiders; other orgs get 404; CSV formulas neutralized                         |
| CRM           | another org gets 404 on read/update/delete/attach; database rejects cross-org child rows; owners must be members; `javascript:` websites rejected; LIKE characters literal; amounts parsed without floats; automatic history can't be deleted; CSV formulas neutralized |
| Dashboard     | metrics count only the active org's rows                                                                                                                                                                                                                                |

**Note:** Better Auth disables its origin check when `NODE_ENV=test`. This project sets `disableOriginCheck: false` explicitly so the protection is always on — and tested.

## Reporting

Please report vulnerabilities privately via GitHub security advisories rather than public issues.
