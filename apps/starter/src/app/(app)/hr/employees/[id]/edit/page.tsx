import { requirePermission } from "@templates/auth/guards"
import { getEmployee, HrError } from "@templates/hr"
import { PageHeader } from "@templates/ui/card"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { EmployeeForm } from "@/components/hr"
import { employeeFormOptions } from "@/components/hr-employee-options"

export const metadata: Metadata = { title: "Edit employee" }

export default async function EditEmployeePage({ params }: PageProps<"/hr/employees/[id]/edit">) {
  const ctx = await requirePermission({ hr: ["manage"] }).catch(() => redirect("/hr"))
  const { id } = await params
  const data = await getEmployee(ctx, id, { showPrivate: true }).catch((e) => {
    if (e instanceof HrError && e.status === 404) notFound()
    throw e
  })
  const e = data.employee
  const opts = await employeeFormOptions(ctx.orgId, id)
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <div>
        <Link
          href={`/hr/employees/${id}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← {e.name}
        </Link>
        <PageHeader title="Edit employee" />
      </div>
      <EmployeeForm
        id={id}
        {...opts}
        initial={{
          name: e.name,
          userId: e.userId ?? "",
          workEmail: e.workEmail ?? "",
          phone: e.phone ?? "",
          jobTitle: e.jobTitle ?? "",
          departmentId: e.departmentId ?? "",
          managerId: e.managerId ?? "",
          employmentType: e.employmentType,
          startDate: e.startDate,
          endDate: e.endDate ?? "",
          status: e.status,
          payType: e.payType ?? "",
          payRate: e.payRateCents === null ? "" : (e.payRateCents / 100).toFixed(2),
          payCurrency: e.payCurrency ?? "",
          birthDate: e.birthDate ?? "",
          homeAddress: e.homeAddress ?? "",
          emergencyContactName: e.emergencyContactName ?? "",
          emergencyContactPhone: e.emergencyContactPhone ?? "",
          privateNotes: e.privateNotes ?? "",
        }}
      />
    </div>
  )
}
