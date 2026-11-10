import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source, so Next compiles them.
  transpilePackages: ["@templates/db"],
}

export default nextConfig
