import { can, requirePermission } from "@templates/auth/guards"
import { directory, hrSummary, listDepartments, listEmployees } from "@templates/hr"
import { EMPLOYMENT_LABELS } from "@templates/hr/definitions"
import { Card, PageHeader } from "@templates/ui/card"
import { cn } from "@templates/ui/cn"
import { Select } from "@templates/ui/form"
import { Plus } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

export const metadata: Metadata = { title: "Staff" }

const timeFmt = (tz: string) =>
  new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", timeZone: tz })

export default async function StaffPage({ searchParams }: PageProps<"/hr">) {
  const { orgId } = await requirePermission({ hr: ["self"] }).catch(() => redirect("/dashboard"))
  const raw = Object.fromEntries(
    Object.entries(await searchParams).map(([k, v]) => [
      k,
      Array.isArray(v) ? v[0] : v || undefined,
    ]),
  )
  const [canRead, canManage, canApprove, departments] = await Promise.all([
    can({ hr: ["read"] }),
    can({ hr: ["manage"] }),
    can({ hr: ["approve"] }),
    listDepartments({ orgId }),
  ])
  const [summary, full, dir] = await Promise.all([
    canRead ? hrSummary({ orgId }) : null,
    canRead ? listEmployees({ orgId }, raw) : null,
    canRead ? null : directory({ orgId }, raw),
  ])
  const filter: { q?: string; department?: string; status?: string } =
    full?.filter ?? dir?.filter ?? {}
  const time = summary ? timeFmt(summary.timeZone) : null

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader
        title="Staff"
        description={
          canRead
            ? "Everyone who works here, who's in today and who's off."
            : "Who's who and how to reach them."
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/hr/me"
              className="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium hover:bg-accent"
            >
              My time & leave
            </Link>
            {canApprove && (
              <Link
                href="/hr/leave"
                className="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium hover:bg-accent"
              >
                Leave
              </Link>
            )}
            {canRead && (
              <Link
                href="/hr/time"
                className="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium hover:bg-accent"
              >
                Timesheets
              </Link>
            )}
            {canManage && (
              <>
                <Link
                  href="/hr/setup"
                  className="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium hover:bg-accent"
                >
                  Setup
                </Link>
                <Link
                  href="/hr/employees/new"
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 [&_svg]:size-4"
                >
                  <Plus /> Add employee
                </Link>
              </>
            )}
          </div>
        }
      />

      {summary && time && (
        <div className="grid gap-3 lg:grid-cols-4">
          <div className="rounded-xl border px-4 py-3">
            <p className="text-xs text-muted-foreground">People</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{summary.headcount}</p>
          </div>
          <div className="rounded-xl border px-4 py-3">
            <p className="text-xs text-muted-foreground">
              Clocked in now · {summary.clockedIn.length}
            </p>
            <p className="mt-1 truncate text-sm">
              {summary.clockedIn.length
                ? summary.clockedIn.map((c) => `${c.name} (${time.format(c.since)})`).join(", ")
                : "Nobody"}
            </p>
          </div>
          <div className="rounded-xl border px-4 py-3">
            <p className="text-xs text-muted-foreground">Off today · {summary.offToday.length}</p>
            <p className="mt-1 truncate text-sm">
              {summary.offToday.length ? summary.offToday.map((o) => o.name).join(", ") : "Nobody"}
            </p>
          </div>
          <Link href="/hr/leave" className="rounded-xl border px-4 py-3 hover:bg-muted/50">
            <p
              className={cn(
                "text-xs text-muted-foreground",
                summary.pendingRequests > 0 && "text-warning",
              )}
            >
              Leave waiting for approval
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{summary.pendingRequests}</p>
          </Link>
        </div>
      )}

      <form action="/hr" className="flex flex-wrap items-end gap-2 text-sm">
        <input
          type="search"
          name="q"
          defaultValue={filter.q ?? ""}
          aria-label="Search people"
          placeholder="Name, title or email…"
          className="h-9 min-w-0 flex-1 rounded-md border bg-transparent px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-64"
        />
        <Select name="department" defaultValue={filter.department ?? ""} aria-label="Department">
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
        {canRead && (
          <Select name="status" defaultValue={filter.status ?? "active"} aria-label="Status">
            <option value="active">Current staff</option>
            <option value="left">People who left</option>
          </Select>
        )}
        <button type="submit" className="h-9 rounded-md border px-4 font-medium hover:bg-accent">
          Filter
        </button>
      </form>

      <Card className="overflow-hidden p-0">
        {full ? (
          full.rows.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">
              {filter.q || filter.department ? "Nobody matches." : "No employees yet."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Name</th>
                    <th className="hidden px-4 py-2.5 font-medium md:table-cell">Department</th>
                    <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Reports to</th>
                    <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Type</th>
                    <th className="px-4 py-2.5 font-medium">Contact</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {full.rows.map((e) => (
                    <tr key={e.id} className="hover:bg-muted/50">
                      <td className="px-4 py-3">
                        <Link
                          href={`/hr/employees/${e.id}`}
                          className="font-medium hover:underline"
                        >
                          {e.name}
                        </Link>
                        <span className="block text-xs text-muted-foreground">
                          {e.jobTitle ?? "—"}
                          {!e.linked && " · no app account"}
                        </span>
                      </td>
                      <td className="hidden px-4 py-3 md:table-cell">{e.departmentName ?? "—"}</td>
                      <td className="hidden px-4 py-3 lg:table-cell">{e.managerName ?? "—"}</td>
                      <td className="hidden px-4 py-3 sm:table-cell">
                        {EMPLOYMENT_LABELS[e.employmentType]}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {e.workEmail ?? ""}
                        {e.phone && <span className="block">{e.phone}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <ul className="grid divide-y text-sm sm:grid-cols-2 sm:divide-y-0">
            {dir?.rows.map((e) => (
              <li key={e.id} className="px-4 py-3 sm:border-b">
                <p className="font-medium">{e.name}</p>
                <p className="text-muted-foreground">
                  {[e.jobTitle, e.departmentName].filter(Boolean).join(" · ") || "—"}
                </p>
                <p className="text-muted-foreground">
                  {[e.workEmail, e.phone].filter(Boolean).join(" · ")}
                </p>
              </li>
            ))}
            {dir?.rows.length === 0 && (
              <li className="p-10 text-center text-muted-foreground">Nobody here yet.</li>
            )}
          </ul>
        )}
      </Card>
    </div>
  )
}
