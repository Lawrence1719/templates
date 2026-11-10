import { fileURLToPath } from "node:url"

import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"

const url =
  process.env.TEST_DATABASE_URL ?? "postgres://templates:templates@localhost:5432/templates_test"

/** Recreates the test database from scratch and applies every migration. */
export default async function setup() {
  const target = new URL(url)
  const dbName = target.pathname.slice(1)
  if (!dbName.endsWith("_test")) throw new Error(`Refusing to reset non-test database "${dbName}"`)

  const admin = new URL(url)
  admin.pathname = "/postgres"
  const sql = postgres(admin.toString(), { max: 1, onnotice: () => {} })
  await sql.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`)
  await sql.unsafe(`CREATE DATABASE "${dbName}"`)
  await sql.end()

  const client = postgres(url, { max: 1, onnotice: () => {} })
  await migrate(drizzle(client), {
    migrationsFolder: fileURLToPath(new URL("../../packages/db/drizzle", import.meta.url)),
  })
  await client.end()
}
