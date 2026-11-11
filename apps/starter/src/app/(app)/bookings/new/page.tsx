import { requirePermission } from "@templates/auth/guards"
import { getBookingSettings, listResources, listServices, today } from "@templates/bookings"
import { db } from "@templates/db"
import { customer } from "@templates/db/schema"
import { Card, PageHeader } from "@templates/ui/card"
import { and, asc, eq, ne } from "drizzle-orm"
import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { StaffBookingForm } from "@/components/bookings"

export const metadata: Metadata = { title: "New booking" }

export default async function NewBookingPage() {
  const ctx = await requirePermission({ booking: ["write"] }).catch(() => redirect("/bookings"))
  const [settings, services, resources, customers] = await Promise.all([
    getBookingSettings(ctx),
    listServices(ctx),
    listResources(ctx),
    db
      .select({
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
      })
      .from(customer)
      .where(and(eq(customer.orgId, ctx.orgId), ne(customer.status, "inactive")))
      .orderBy(asc(customer.name))
      .limit(2000),
  ])
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <PageHeader title="New booking" />
      {services.length === 0 || resources.length === 0 ? (
        <Card className="text-sm">
          Add a service and someone to book in{" "}
          <Link href="/bookings/setup" className="underline">
            setup
          </Link>{" "}
          first.
        </Card>
      ) : (
        <Card>
          <StaffBookingForm
            services={services}
            resources={resources}
            customers={customers}
            timeZone={settings.timeZone}
            defaultDay={today(settings.timeZone)}
          />
        </Card>
      )}
    </div>
  )
}
