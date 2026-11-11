import { publicAvailability } from "@templates/bookings"

/** Free times for the public page. Returns times only, never who or what else is booked. */
export async function GET(req: Request, { params }: RouteContext<"/book/[slug]/slots">) {
  const url = new URL(req.url)
  const r = await publicAvailability((await params).slug, {
    serviceId: url.searchParams.get("service") ?? "",
    resourceId: url.searchParams.get("resource") ?? "any",
    day: url.searchParams.get("day") ?? "",
  })
  if (!r) return Response.json({ error: "Not found" }, { status: 404 })
  return Response.json(r, { headers: { "Cache-Control": "no-store" } })
}
