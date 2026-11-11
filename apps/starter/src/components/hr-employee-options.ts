import { listDepartments, listEmployees, memberOptions } from "@templates/hr"

/** Pickers for the employee form. */
export async function employeeFormOptions(orgId: string, selfId: string | null) {
  const [members, departments, people] = await Promise.all([
    memberOptions({ orgId }),
    listDepartments({ orgId }),
    listEmployees({ orgId }),
  ])
  return {
    members: members.map((m) => ({
      userId: m.userId,
      name: m.name,
      email: m.email,
      taken: !!m.employeeId,
    })),
    departments: departments.map((d) => ({ id: d.id, name: d.name })),
    managers: people.rows.filter((p) => p.id !== selfId).map((p) => ({ id: p.id, name: p.name })),
  }
}
