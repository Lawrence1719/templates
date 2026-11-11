import { can, requirePermission } from "@templates/auth/guards"
import {
  BookingError,
  formatDate,
  formatMoney,
  formatTime,
  getBooking,
  STATUS_LABELS,
} from "@templates/bookings"
import { Card } from "@templates/ui/card"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { BookingStatusActions } from "@/components/bookings"
import { timeAgo } from "@/components/time-ago"

export const metadata: Metadata = { title: "Booking" }

export default async function BookingPage({ params }: PageProps<"/bookings/[id]">) {
  const { id } = await params
  const ctx = await requirePermission({ booking: ["read"] }).catch(() => redirect("/dashboard"))
  const data = await getBooking(ctx, id).catch((e) => {
    if (e instanceof BookingError) notFound()
    throw e
  })
  const {
    booking: b,
    serviceName,
    resourceName,
    priceCents,
    currency,
    timeZone,
    createdByName,
  } = data
  const canWrite = await can({ booking: ["write"] })

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <Link href="/bookings" className="text-sm text-muted-foreground hover:text-foreground">
            ← Bookings
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">
            {serviceName} · {b.customerName}
          </h1>
          <p className="text-sm text-muted-foreground">
            {formatDate(b.startsAt, timeZone)}, {formatTime(b.startsAt, timeZone)}–
            {formatTime(b.endsAt, timeZone)} with {resourceName}
          </p>
        </div>
        {canWrite && (
          <BookingStatusActions
            id={b.id}
            status={b.status}
            started={b.startsAt.getTime() <= Date.now()}
          />
        )}
      </div>
      <Card className="grid gap-3 text-sm">
        <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-2">
          <dt className="text-muted-foreground">Status</dt>
          <dd>{STATUS_LABELS[b.status]}</dd>
          {b.cancelReason && (
            <>
              <dt className="text-muted-foreground">Reason</dt>
              <dd>{b.cancelReason}</dd>
            </>
          )}
          {b.customerEmail && (
            <>
              <dt className="text-muted-foreground">Email</dt>
              <dd>
                <a className="hover:underline" href={`mailto:${b.customerEmail}`}>
                  {b.customerEmail}
                </a>
              </dd>
            </>
          )}
          {b.customerPhone && (
            <>
              <dt className="text-muted-foreground">Phone</dt>
              <dd>
                <a
                  className="hover:underline"
                  href={`tel:${b.customerPhone.replace(/[^\d+]/g, "")}`}
                >
                  {b.customerPhone}
                </a>
              </dd>
            </>
          )}
          {b.customerId && (
            <>
              <dt className="text-muted-foreground">Customer</dt>
              <dd>
                <Link href={`/customers/${b.customerId}`} className="hover:underline">
                  Open in CRM
                </Link>
              </dd>
            </>
          )}
          <dt className="text-muted-foreground">Price</dt>
          <dd>{formatMoney(priceCents, currency)}</dd>
          {b.notes && (
            <>
              <dt className="text-muted-foreground">Notes</dt>
              <dd className="whitespace-pre-wrap">{b.notes}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Booked</dt>
          <dd>
            {b.source === "online" ? "Online" : `By ${createdByName ?? "staff"}`} ·{" "}
            {timeAgo(b.createdAt)}
          </dd>
        </dl>
      </Card>
    </div>
  )
}
