import { formatDate, formatTime, getBookingByToken, STATUS_LABELS } from "@templates/bookings"
import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { CancelBookingButton } from "@/components/public-booking"

// The link is the credential: keep it out of search engines and other sites' logs.
export const metadata: Metadata = {
  title: "Your booking",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
}

export default async function ManageBookingPage({ params }: PageProps<"/book/manage/[token]">) {
  const data = await getBookingByToken((await params).token)
  if (!data) notFound()
  const { booking: b, serviceName, resourceName, orgName, timeZone, canCancel } = data
  const live = b.status === "pending" || b.status === "confirmed"
  return (
    <main className="min-h-dvh bg-muted/40 px-4 py-10">
      <div className="mx-auto grid max-w-lg gap-4 rounded-xl border bg-background p-6">
        <p className="text-sm text-muted-foreground">{orgName}</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {b.status === "pending"
            ? "Request received"
            : b.status === "confirmed"
              ? "You're booked"
              : STATUS_LABELS[b.status]}
        </h1>
        <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">What</dt>
          <dd>{serviceName}</dd>
          <dt className="text-muted-foreground">When</dt>
          <dd>
            {formatDate(b.startsAt, timeZone)}, {formatTime(b.startsAt, timeZone)}–
            {formatTime(b.endsAt, timeZone)}
            <span className="block text-xs text-muted-foreground">{timeZone}</span>
          </dd>
          <dt className="text-muted-foreground">With</dt>
          <dd>{resourceName}</dd>
          <dt className="text-muted-foreground">Name</dt>
          <dd>{b.customerName}</dd>
        </dl>
        {b.status === "pending" && (
          <p className="text-sm text-muted-foreground">
            We'll email you once it's confirmed. Keep this page's link to check or cancel.
          </p>
        )}
        {live &&
          (canCancel ? (
            <CancelBookingButton token={b.manageToken} />
          ) : (
            <p className="text-sm text-muted-foreground">
              To change or cancel now, please contact {orgName}.
            </p>
          ))}
      </div>
    </main>
  )
}
