import { existsSync } from "node:fs"

import type { NextConfig } from "next"

// One .env at the repo root is shared by the app and the db tooling.
if (existsSync("../../.env")) process.loadEnvFile("../../.env")

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source, so Next compiles them.
  transpilePackages: ["@templates/db", "@templates/auth", "@templates/ui", "@templates/shell"],
}

export default nextConfig
