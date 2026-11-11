import { requirePermission } from "@templates/auth/guards"
import { getHrSettings, listDepartments, listHolidays, listLeaveTypes } from "@templates/hr"
import { addDays, today } from "@templates/hr/definitions"
import { Card, PageHeader } from "@templates/ui/card"
import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { DepartmentEditor, HolidayEditor, HrSettingsForm, LeaveTypeEditor } from "@/components/hr"

export const metadata: Metadata = { title: "HR setup" }

export default async function HrSetupPage() {
  const ctx = await requirePermission({ hr: ["manage"] }).catch(() => redirect("/hr"))
  const settings = await getHrSettings(ctx)
  const t = today(settings.timeZone)
  const [departments, types, holidays] = await Promise.all([
    listDepartments(ctx),
    listLeaveTypes(ctx, { includeArchived: true }),
    listHolidays(ctx, { from: addDays(t, -30), to: addDays(t, 400) }),
  ])
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <PageHeader
        title="HR setup"
        description="Work week, leave rules, departments and holidays."
      />
      <Card className="grid gap-4 p-5">
        <h2 className="font-semibold">Work week</h2>
        <HrSettingsForm
          initial={{
            timeZone: settings.timeZone,
            workDays: settings.workDays,
            leaveYearStartMonth: settings.leaveYearStartMonth,
            weeklyHours: settings.weeklyHours,
          }}
        />
      </Card>
      <Card className="grid gap-4 p-5">
        <div>
          <h2 className="font-semibold">Kinds of leave</h2>
          <p className="text-sm text-muted-foreground">
            Days a year per person. Leave blank for leave with no limit.
          </p>
        </div>
        <LeaveTypeEditor types={types} />
      </Card>
      <Card className="grid gap-4 p-5">
        <div>
          <h2 className="font-semibold">Holidays</h2>
          <p className="text-sm text-muted-foreground">These days never count as leave.</p>
        </div>
        <HolidayEditor holidays={holidays} />
      </Card>
      <Card className="grid gap-4 p-5">
        <h2 className="font-semibold">Departments</h2>
        <DepartmentEditor departments={departments} />
      </Card>
    </div>
  )
}
