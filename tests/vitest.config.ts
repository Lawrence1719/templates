import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

const base =
  process.env.TEST_DATABASE_URL ?? "postgres://templates:templates@localhost:5432/templates_test"

export default defineConfig({
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./setup/server-only.ts", import.meta.url)),
      "next/headers": fileURLToPath(new URL("./setup/next-headers.ts", import.meta.url)),
    },
  },
  test: {
    // Integration tests share one database, so run files one at a time.
    fileParallelism: false,
    globalSetup: ["./setup/global.ts"],
    testTimeout: 20_000,
    env: {
      DATABASE_URL: base,
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123",
      BETTER_AUTH_URL: "http://localhost:3000",
    },
  },
})
