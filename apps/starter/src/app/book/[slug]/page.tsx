import { getPublicBookingPage } from "@templates/bookings"
import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { PublicBooking } from "@/components/public-booking"

export const metadata: Metadata = {
  title: "Book online",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
}

/** The public booking page. No account needed; only free times are shown, never other bookings. */
export default async function BookPage({ params }: PageProps<"/book/[slug]">) {
  const { slug } = await params
  const page = await getPublicBookingPage(slug)
  if (!page) notFound()
  return (
    <main className="min-h-dvh bg-muted/40 px-4 py-10">
      <div className="mx-auto grid max-w-2xl gap-6">
        <header>
          <p className="text-sm text-muted-foreground">Book online</p>
          <h1 className="text-2xl font-semibold tracking-tight">{page.orgName}</h1>
          {page.requireApproval && (
            <p className="mt-1 text-sm text-muted-foreground">
              Requests are confirmed by email once approved.
            </p>
          )}
        </header>
        <div className="rounded-xl border bg-background p-5 sm:p-6">
          {page.services.length === 0 || page.resources.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Online booking isn't available right now.
            </p>
          ) : (
            <PublicBooking
              slug={slug}
              timeZone={page.timeZone}
              maxDaysAhead={page.maxDaysAhead}
              services={page.services}
              resources={page.resources}
            />
          )}
        </div>
      </div>
    </main>
  )
}
