import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import { z } from "zod"

import * as schema from "./schema"

// Validate the connection string once at startup instead of failing on first query.
const env = z.object({ DATABASE_URL: z.url() }).parse(process.env)

// Reuse the client across hot reloads in development.
const globalForDb = globalThis as unknown as { pg?: ReturnType<typeof postgres> }
const client = globalForDb.pg ?? postgres(env.DATABASE_URL, { prepare: false })
if (process.env.NODE_ENV !== "production") globalForDb.pg = client

export const db = drizzle(client, { schema, casing: "snake_case" })
export type Db = typeof db
export { schema }
