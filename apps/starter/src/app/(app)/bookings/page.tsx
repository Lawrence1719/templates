import { can, requirePermission } from "@templates/auth/guards"
import {
  addDays,
  bookingSummary,
  formatDayLabel,
  formatTime,
  isDay,
  listBookings,
  listResources,
  localParts,
  STATUS_LABELS,
} from "@templates/bookings"
import { Card, PageHeader } from "@templates/ui/card"
import { cn } from "@templates/ui/cn"
import { Plus, Settings } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

export const metadata: Metadata = { title: "Bookings" }

const DAYS = 7

export default async function BookingsPage({ searchParams }: PageProps<"/bookings">) {
  const { orgId } = await requirePermission({ booking: ["read"] }).catch(() =>
    redirect("/dashboard"),
  )
  const sp = await searchParams
  const summary = await bookingSummary({ orgId })
  const from = typeof sp.from === "string" && isDay(sp.from) ? sp.from : summary.day
  const resource = typeof sp.resource === "string" ? sp.resource : undefined
  const [{ rows, timeZone }, resources, canWrite, canManage] = await Promise.all([
    listBookings({ orgId }, { from, days: DAYS, resourceId: resource }),
    listResources({ orgId }),
    can({ booking: ["write"] }),
    can({ booking: ["manage"] }),
  ])
  const days = Array.from({ length: DAYS }, (_, i) => addDays(from, i))
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries({ from, resource, ...patch })) if (v) p.set(k, v)
    return `/bookings?${p}`
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader
        title="Bookings"
        description={`Appointments and reservations. Times in ${timeZone}.`}
        actions={
          <div className="flex gap-2">
            {canManage && (
              <Link
                href="/bookings/setup"
                aria-label="Booking setup"
                className="inline-flex size-9 items-center justify-center rounded-md border hover:bg-accent [&_svg]:size-4"
              >
                <Settings />
              </Link>
            )}
            {canWrite && (
              <Link
                href="/bookings/new"
                className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 [&_svg]:size-4"
              >
                <Plus /> New booking
              </Link>
            )}
          </div>
        }
      />

      <dl className="grid gap-3 sm:grid-cols-3">
        {[
          ["Today", summary.today],
          ["Next 7 days", summary.week],
          ["Waiting for approval", summary.pending],
        ].map(([label, n]) => (
          <div key={label} className="rounded-xl border px-4 py-3">
            <dt
              className={cn(
                "text-xs text-muted-foreground",
                label === "Waiting for approval" && Number(n) > 0 && "text-danger",
              )}
            >
              {label}
            </dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{n}</dd>
          </div>
        ))}
      </dl>

      {resources.length === 0 ? (
        <Card className="text-sm">
          {canManage ? (
            <>
              Start in{" "}
              <Link href="/bookings/setup" className="underline">
                setup
              </Link>
              : add your services and who can be booked.
            </>
          ) : (
            "Bookings haven't been set up yet."
          )}
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <Link
                href={qs({ from: addDays(from, -DAYS) })}
                className="rounded-md border px-3 py-1.5 hover:bg-accent"
                aria-label="Previous week"
              >
                ←
              </Link>
              <Link
                href={qs({ from: summary.day })}
                className="rounded-md border px-3 py-1.5 hover:bg-accent"
              >
                Today
              </Link>
              <Link
                href={qs({ from: addDays(from, DAYS) })}
                className="rounded-md border px-3 py-1.5 hover:bg-accent"
                aria-label="Next week"
              >
                →
              </Link>
            </div>
            <nav aria-label="Filter by person" className="flex flex-wrap gap-1.5 text-sm">
              {[{ id: undefined, name: "Everyone" }, ...resources].map((r) => (
                <Link
                  key={r.id ?? "all"}
                  href={qs({ resource: r.id })}
                  aria-current={resource === r.id ? "page" : undefined}
                  className={cn(
                    "rounded-full border px-3 py-1",
                    resource === r.id
                      ? "border-foreground bg-accent font-medium"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {r.name}
                </Link>
              ))}
            </nav>
          </div>

          <div className="grid gap-4">
            {days.map((d) => {
              const items = rows.filter((r) => localParts(r.startsAt, timeZone).day === d)
              return (
                <section key={d} aria-label={formatDayLabel(d)} className="grid gap-2">
                  <h2
                    className={cn("text-sm font-semibold", d === summary.day && "text-foreground")}
                  >
                    {formatDayLabel(d)}
                    {d === summary.day && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">today</span>
                    )}
                  </h2>
                  {items.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No bookings.</p>
                  ) : (
                    <ul className="divide-y rounded-xl border">
                      {items.map((b) => (
                        <li key={b.id}>
                          <Link
                            href={`/bookings/${b.id}`}
                            className={cn(
                              "flex flex-wrap items-baseline gap-x-4 gap-y-0.5 px-4 py-3 text-sm hover:bg-muted/50",
                              (b.status === "cancelled" || b.status === "no_show") &&
                                "text-muted-foreground",
                            )}
                          >
                            <span className="w-28 shrink-0 font-medium tabular-nums">
                              {formatTime(b.startsAt, timeZone)}–{formatTime(b.endsAt, timeZone)}
                            </span>
                            <span
                              className={cn(
                                "min-w-0 flex-1",
                                b.status === "cancelled" && "line-through",
                              )}
                            >
                              {b.customerName} · {b.serviceName}
                            </span>
                            <span className="text-xs text-muted-foreground">{b.resourceName}</span>
                            {b.status !== "confirmed" && (
                              <span
                                className={cn(
                                  "rounded-full border px-2 py-0.5 text-xs",
                                  b.status === "pending" && "border-danger/50 text-danger",
                                  b.status === "completed" && "border-success/40 text-success",
                                )}
                              >
                                {STATUS_LABELS[b.status]}
                              </span>
                            )}
                            {b.source === "online" && (
                              <span className="text-xs text-muted-foreground">online</span>
                            )}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
