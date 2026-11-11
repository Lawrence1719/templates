import { requirePermission } from "@templates/auth/guards"
import { timesheet } from "@templates/hr"
import { addDays, formatHours, isDay } from "@templates/hr/definitions"
import { Card, PageHeader } from "@templates/ui/card"
import { cn } from "@templates/ui/cn"
import { Download } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { formatHrDay, formatLongDay } from "@/components/hr-format"

export const metadata: Metadata = { title: "Timesheets" }

export default async function TimesheetsPage({ searchParams }: PageProps<"/hr/time">) {
  const ctx = await requirePermission({ hr: ["read"] }).catch(() => redirect("/hr"))
  const sp = await searchParams
  const w = Array.isArray(sp.week) ? sp.week[0] : sp.week
  const sheet = await timesheet(ctx, { week: w && isDay(w) ? w : undefined })
  const prev = addDays(sheet.weekStart, -7)
  const next = addDays(sheet.weekStart, 7)
  const total = sheet.people.reduce((n, p) => n + p.totalMinutes, 0)

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader
        title="Timesheets"
        description={`Clocked time, ${sheet.timeZone}. Over ${sheet.weeklyHours}h a week counts as overtime.`}
        actions={
          <a
            href={`/hr/time/export?week=${sheet.weekStart}`}
            className="inline-flex h-9 items-center gap-2 rounded-md border px-4 text-sm font-medium hover:bg-accent [&_svg]:size-4"
          >
            <Download /> CSV
          </a>
        }
      />
      <nav className="flex items-center justify-between gap-2 text-sm" aria-label="Week">
        <Link
          href={`/hr/time?week=${prev}`}
          className="rounded-md border px-3 py-1.5 hover:bg-accent"
        >
          ← Previous
        </Link>
        <p className="font-medium">
          {formatHrDay(sheet.weekStart)} – {formatLongDay(addDays(sheet.weekStart, 6))}
        </p>
        <Link
          href={`/hr/time?week=${next}`}
          className="rounded-md border px-3 py-1.5 hover:bg-accent"
        >
          Next →
        </Link>
      </nav>
      <Card className="overflow-hidden p-0">
        {sheet.people.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            No time clocked this week.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Person</th>
                  {sheet.days.map((d) => (
                    <th key={d} className="px-3 py-2.5 text-right font-medium whitespace-nowrap">
                      {formatHrDay(d).split(",")[0]}
                    </th>
                  ))}
                  <th className="px-4 py-2.5 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sheet.people.map((p) => (
                  <tr key={p.employeeId} className="hover:bg-muted/50">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Link
                        href={`/hr/employees/${p.employeeId}?week=${sheet.weekStart}`}
                        className="font-medium hover:underline"
                      >
                        {p.name}
                      </Link>
                      {p.open && <span className="ml-2 text-xs text-success">in now</span>}
                    </td>
                    {p.days.map((d) => (
                      <td
                        key={d.day}
                        className={cn(
                          "px-3 py-3 text-right tabular-nums",
                          !d.minutes && "text-muted-foreground",
                        )}
                      >
                        {d.minutes ? formatHours(d.minutes) : "–"}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right font-medium tabular-nums whitespace-nowrap">
                      {formatHours(p.totalMinutes)}
                      {p.overtimeMinutes > 0 && (
                        <span className="block text-xs font-normal text-warning">
                          +{formatHours(p.overtimeMinutes)} overtime
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t bg-muted/40">
                <tr>
                  <td className="px-4 py-2.5 font-medium" colSpan={8}>
                    Everyone
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                    {formatHours(total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
