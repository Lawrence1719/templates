import { requirePermission } from "@templates/auth/guards"
import { getHrSettings } from "@templates/hr"
import { today } from "@templates/hr/definitions"
import { PageHeader } from "@templates/ui/card"
import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { EmployeeForm } from "@/components/hr"
import { employeeFormOptions } from "@/components/hr-employee-options"

export const metadata: Metadata = { title: "Add employee" }

export default async function NewEmployeePage() {
  const ctx = await requirePermission({ hr: ["manage"] }).catch(() => redirect("/hr"))
  const [opts, settings] = await Promise.all([
    employeeFormOptions(ctx.orgId, null),
    getHrSettings(ctx),
  ])
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <PageHeader
        title="Add employee"
        description="Link their app account so they can clock in and ask for leave."
      />
      <EmployeeForm
        id={null}
        {...opts}
        initial={{
          name: "",
          userId: "",
          workEmail: "",
          phone: "",
          jobTitle: "",
          departmentId: "",
          managerId: "",
          employmentType: "full_time",
          startDate: today(settings.timeZone),
          endDate: "",
          status: "active",
          payType: "",
          payRate: "",
          payCurrency: "",
          birthDate: "",
          homeAddress: "",
          emergencyContactName: "",
          emergencyContactPhone: "",
          privateNotes: "",
        }}
      />
    </div>
  )
}
