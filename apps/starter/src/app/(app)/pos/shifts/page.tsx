import { requirePermission } from "@templates/auth/guards"
import { formatMoney, getPosSettings, listShifts } from "@templates/pos"
import { Card, PageHeader } from "@templates/ui/card"
import { cn } from "@templates/ui/cn"
import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

export const metadata: Metadata = { title: "Shifts" }

const stamp = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })

export default async function ShiftsPage({ searchParams }: PageProps<"/pos/shifts">) {
  const { orgId } = await requirePermission({ pos: ["read"] }).catch(() => redirect("/dashboard"))
  const sp = await searchParams
  const page = Number(Array.isArray(sp.page) ? sp.page[0] : sp.page) || 1
  const [{ rows, total, pageSize }, settings] = await Promise.all([
    listShifts({ orgId }, { page }),
    getPosSettings({ orgId }),
  ])
  const money = (c: number) => formatMoney(c, settings.currency)
  const pages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader
        title="Shifts"
        description="Each till session, from opening float to the cash count."
      />
      <Card className="overflow-hidden p-0">
        {rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No shifts yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Opened</th>
                  <th className="px-4 py-2.5 font-medium">Register</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Cashier</th>
                  <th className="px-4 py-2.5 text-right font-medium">Sales</th>
                  <th className="px-4 py-2.5 text-right font-medium">Drawer</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((s) => (
                  <tr key={s.id} className="hover:bg-muted/50">
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link href={`/pos/shifts/${s.id}`} className="font-medium hover:underline">
                        {stamp.format(s.openedAt)}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{s.registerName}</td>
                    <td className="hidden px-4 py-3 md:table-cell">{s.openedBy ?? "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {money(s.salesCents)}
                      <span className="block text-xs text-muted-foreground">{s.sales} sales</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {s.status === "open" ? (
                        <span className="text-success">Open</span>
                      ) : (
                        <span
                          className={cn(
                            (s.varianceCents ?? 0) < 0 && "text-danger",
                            (s.varianceCents ?? 0) === 0 && "text-muted-foreground",
                          )}
                        >
                          {(s.varianceCents ?? 0) === 0
                            ? "Matched"
                            : `${money(Math.abs(s.varianceCents ?? 0))} ${(s.varianceCents ?? 0) < 0 ? "short" : "over"}`}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {total > pageSize && (
        <nav className="flex items-center justify-between text-sm" aria-label="Pagination">
          <span className="text-muted-foreground">
            page {page} of {pages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                className="rounded-md border px-3 py-1.5 hover:bg-accent"
                href={`/pos/shifts?page=${page - 1}`}
              >
                Previous
              </Link>
            )}
            {page < pages && (
              <Link
                className="rounded-md border px-3 py-1.5 hover:bg-accent"
                href={`/pos/shifts?page=${page + 1}`}
              >
                Next
              </Link>
            )}
          </div>
        </nav>
      )}
    </div>
  )
}
