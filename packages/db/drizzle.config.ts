import { existsSync } from "node:fs"

import { defineConfig } from "drizzle-kit"

// Load the repo-root .env when present (CI passes real env vars instead).
if (existsSync("../../.env")) process.loadEnvFile("../../.env")

const url = process.env.DATABASE_URL
if (!url) throw new Error("DATABASE_URL is not set")

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
})
