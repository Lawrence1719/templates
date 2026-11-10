# Integration tests

Run against a real Postgres database (`templates_test`, recreated on every run) and the real Better Auth handler, called in-process.

```bash
docker compose up -d   # from the repo root
pnpm test
```

- `setup/global.ts` — drops and recreates the test database, applies all migrations. Refuses to touch a database whose name doesn't end in `_test`.
- `setup/client.ts` — `TestClient` keeps cookies and a unique IP per user (so rate limits don't leak between tests); helpers `newUser`, `newOrgOwner`, `addMember`.
- `setup/next-headers.ts` — stands in for `next/headers` so server code sees the in-flight test request.

Override the database with `TEST_DATABASE_URL`.
