import { auth } from "@templates/auth"
import { requirePermission } from "@templates/auth/guards"
import {
  formatDate,
  formatMoney,
  formatTime,
  getBookingSettings,
  listResources,
  listServices,
  listTimeOff,
} from "@templates/bookings"
import { appUrl } from "@templates/notifications"
import { Card, PageHeader } from "@templates/ui/card"
import { cn } from "@templates/ui/cn"
import type { Metadata } from "next"
import { headers } from "next/headers"
import { redirect } from "next/navigation"

import {
  BookingSettingsForm,
  DeleteTimeOffButton,
  PublicLink,
  ResourceEditor,
  ServiceEditor,
  TimeOffForm,
} from "@/components/bookings"

export const metadata: Metadata = { title: "Booking setup" }

export default async function BookingSetupPage() {
  const ctx = await requirePermission({ booking: ["manage"] }).catch(() => redirect("/bookings"))
  const [settings, services, resources, timeOff, org] = await Promise.all([
    getBookingSettings(ctx),
    listServices(ctx, { includeArchived: true }),
    listResources(ctx, { includeArchived: true }),
    listTimeOff(ctx),
    auth.api.getFullOrganization({ headers: await headers() }).catch(() => null),
  ])
  const members = (org?.members ?? []).map((m) => ({ id: m.userId, name: m.user.name }))
  const active = resources
    .filter((r) => r.status === "active")
    .map((r) => ({ id: r.id, name: r.name }))
  const timeZones = Intl.supportedValuesOf("timeZone")

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <PageHeader
        title="Booking setup"
        description="What people can book, who does it, when, and how online booking works."
      />

      <Card className="grid gap-4">
        <h2 className="font-semibold">Online booking</h2>
        <PublicLink url={appUrl(`/book/${settings.publicSlug}`)} enabled={settings.publicEnabled} />
        <BookingSettingsForm
          timeZones={timeZones}
          initial={{
            timeZone: settings.timeZone,
            slotMinutes: String(settings.slotMinutes),
            minNoticeMinutes: String(settings.minNoticeMinutes),
            maxDaysAhead: String(settings.maxDaysAhead),
            cancelNoticeMinutes: String(settings.cancelNoticeMinutes),
            requireApproval: settings.requireApproval,
            publicEnabled: settings.publicEnabled,
          }}
        />
      </Card>

      <Card className="grid gap-4">
        <h2 className="font-semibold">Services</h2>
        <ul className="grid gap-3">
          {services.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-start justify-between gap-3 border-b pb-3 last:border-0"
            >
              <div className={cn("min-w-0", s.status !== "active" && "text-muted-foreground")}>
                <p className="font-medium">
                  {s.name}
                  {s.status !== "active" && (
                    <span className="ml-2 text-xs font-normal">(archived)</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {s.durationMinutes} min{s.bufferMinutes > 0 && ` + ${s.bufferMinutes} min gap`} ·{" "}
                  {formatMoney(s.priceCents, s.currency)} ·{" "}
                  {s.resourceIds.length
                    ? resources
                        .filter((r) => s.resourceIds.includes(r.id))
                        .map((r) => r.name)
                        .join(", ")
                    : "Everyone"}
                </p>
              </div>
              <ServiceEditor service={s} resources={active} />
            </li>
          ))}
        </ul>
        <div>
          <ServiceEditor resources={active} />
        </div>
      </Card>

      <Card className="grid gap-5">
        <div>
          <h2 className="font-semibold">People and rooms</h2>
          <p className="text-sm text-muted-foreground">
            Weekly hours are in {settings.timeZone}. New ones start Monday–Friday, 9–5.
          </p>
        </div>
        {resources.map((r) => (
          <div key={r.id} className="border-b pb-5 last:border-0">
            <ResourceEditor resource={r} members={members} />
          </div>
        ))}
        <div>
          <ResourceEditor members={members} />
        </div>
      </Card>

      {active.length > 0 && (
        <Card className="grid gap-4">
          <h2 className="font-semibold">Time off</h2>
          {timeOff.length > 0 && (
            <ul className="grid gap-2 text-sm">
              {timeOff.map((t) => (
                <li key={t.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{t.resourceName}</span> ·{" "}
                    {formatDate(t.startsAt, settings.timeZone)}{" "}
                    {formatTime(t.startsAt, settings.timeZone)} →{" "}
                    {formatDate(t.endsAt, settings.timeZone)}{" "}
                    {formatTime(t.endsAt, settings.timeZone)}
                    {t.reason && <span className="text-muted-foreground"> · {t.reason}</span>}
                  </span>
                  <DeleteTimeOffButton id={t.id} />
                </li>
              ))}
            </ul>
          )}
          <TimeOffForm resources={active} />
        </Card>
      )}
    </div>
  )
}
