import { z } from "zod"

export const env = z
  .object({
    BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
    BETTER_AUTH_URL: z.url(),
  })
  .parse(process.env)
