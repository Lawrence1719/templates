import { createHash, timingSafeEqual } from "node:crypto"

import { runMembershipJobs } from "@templates/memberships"

/**
 * Renews auto-renew memberships and emails renewal reminders. Call it from a
 * scheduler (Vercel Cron, GitHub Actions, cron) with
 * `Authorization: Bearer $CRON_SECRET`, e.g. once an hour. Safe to repeat.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || secret.length < 16)
    return Response.json(
      { error: "Set CRON_SECRET (16+ characters) to enable scheduled jobs." },
      { status: 503 },
    )
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? ""
  // Compare hashes so the check takes the same time whatever was sent.
  const a = createHash("sha256").update(given).digest()
  const b = createHash("sha256").update(secret).digest()
  if (!timingSafeEqual(a, b)) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const result = await runMembershipJobs()
  return Response.json(result, { headers: { "Cache-Control": "no-store" } })
}
