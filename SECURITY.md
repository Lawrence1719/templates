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
- **Tasks** use the same composite `(…, org_id)` foreign keys for projects, checklist items and comments; assignees must be members; repeating tasks spawn their next occurrence once, inside a transaction.
- **Invoices** are locked by a database trigger once sent (lines, totals, customer, number and dates can't change; no deletes), numbered from a row-locked counter, and paid under a row lock with a `paid ≤ total` check. Money is integer cents with exact rounding. Customer links are 144-bit, `noindex` and `no-referrer`.
- **Inventory** keeps an append-only stock ledger (trigger blocks edits and deletes), locks stock rows for every movement, keeps quantities ≥ 0 with a database check, and writes both sides of a transfer in one transaction.
- **Orders** are locked by a trigger once fulfilled or cancelled (no edits, reopening or deletes), keep an append-only history, and fulfill all product lines from stock in one transaction under row locks.
- **Bookings** can't overlap: a Postgres exclusion constraint refuses two active bookings for the same person or room. Online bookings are re-checked against live availability, guarded by a honeypot and a per-IP limit, and the public page never shows other bookings.
- **Point of sale** takes prices from the catalog, never the till; each sale carries a key so a retry can't charge twice; sales, payments, refunds and closed shifts are locked by triggers (only refunded amounts can grow, up to what was sold); nothing can be added to a closed shift; cash refunds and cash out can't exceed what the drawer should hold; large discounts need `pos: manage`.
- **Staff & HR** hides pay, birthdays, home addresses, emergency contacts and notes from everyone without `hr: manage` (stripped on the server, never sent to the page) and never writes those values to the audit log. Clocked time can't overlap and each person has one open entry (exclusion constraint and unique index). Pending and approved leave can't overlap; balance checks run under a row lock; nobody approves their own request; decided leave can only be cancelled; balance adjustments are append-only.
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

| Area          | What's tested                                                                                                                                                                                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth          | sign-up/out, wrong password, password length, no hash in responses, sign-in rate limit                                                                                                                                                                                                         |
| CSRF          | signed-in requests from a foreign or missing origin are rejected                                                                                                                                                                                                                               |
| Tenancy       | non-members can't read, switch into, or invite into another org; invites only work for the invited email; removed members lose access                                                                                                                                                          |
| Roles         | members can't manage anything; admins manage people but can't delete the org; per-permission matrix                                                                                                                                                                                            |
| Audit         | right actor per event, IP captured, UPDATE/DELETE rejected, org-scoped queries and exports, LIKE escaping, CSV formula neutralization                                                                                                                                                          |
| Notifications | only owners/admins hear about joins; preferences respected; non-members never notified; another user can't mark yours read; same user's orgs kept separate; HTML in names escaped in emails; off-site links dropped                                                                            |
| Files         | disguised and dangerous types rejected; path-traversal names sanitized; text never served inline; other orgs get 404 on list/download/delete; members delete only their own files; bytes removed on delete                                                                                     |
| Forms         | invalid/extra answers rejected; drafts and closed forms refuse responses; honeypot drops bots; 6th submission per IP is 429; raw IPs never stored; members-only forms refuse guests and outsiders; other orgs get 404; CSV formulas neutralized                                                |
| CRM           | another org gets 404 on read/update/delete/attach; database rejects cross-org child rows; owners must be members; `javascript:` websites rejected; LIKE characters literal; amounts parsed without floats; automatic history can't be deleted; CSV formulas neutralized                        |
| Tasks         | another org gets 404 on every task/project action; database rejects cross-org checklist rows; can't file into another org's or an archived project; members delete only their own tasks and comments; repeats never duplicate; LIKE characters literal                                         |
| Invoicing     | sent invoices can't be edited or deleted even with direct SQL; six concurrent sends get six distinct numbers; five concurrent payments can't overpay; rounding exact; customers with invoices can't be deleted; other orgs get 404 and can't bill your customers; draft and bad links 404      |
| Inventory     | ledger can't be edited or deleted even with direct SQL; 8 concurrent issues against 5 in stock let exactly 5 through; opposite transfers don't deadlock; failed transfers change nothing; stock never negative; other orgs get 404 and can't mix locations                                     |
| Orders        | finished orders can't be edited, reopened or deleted even with direct SQL; history can't be rewritten; short stock changes nothing and names the lines; two orders racing for stock ship once; numbers unique under concurrency; other orgs get 404                                            |
| Bookings      | 8 simultaneous requests for one slot: exactly one wins; buffers respected; times not offered are refused; DST gaps never offered; bots get a fake success; 11th booking per IP per hour is 429; old public links stop working; other orgs get 404 and can't use your people or services        |
| Point of sale | same sale key sent 5 times at once charges once; 5 buyers for the last 3 items: exactly 3 sales; failed sales roll back the receipt number; racing refunds give money back once; sales and closed shifts can't be edited even with direct SQL; tampered prices ignored; other orgs get 404     |
| Staff & HR    | private fields absent unless HR asks; audit log names changed fields, not values; 5 clock-ins at once open one shift; overlapping time refused even with direct SQL; three requests at once can't overdraw a balance; self-approval refused; decided leave can't be edited; other orgs get 404 |
| Dashboard     | metrics count only the active org's rows                                                                                                                                                                                                                                                       |

**Note:** Better Auth disables its origin check when `NODE_ENV=test`. This project sets `disableOriginCheck: false` explicitly so the protection is always on — and tested.

## Reporting

Please report vulnerabilities privately via GitHub security advisories rather than public issues.
