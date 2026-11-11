"use server"

import { AuthError, can, requirePermission } from "@templates/auth/guards"
import type { Permissions } from "@templates/auth/permissions"
import {
  type AdjustmentInput,
  addHoliday,
  addLeaveAdjustment,
  addTimeEntry,
  cancelLeave,
  clockIn,
  clockOut,
  createEmployee,
  type DepartmentInput,
  decideLeave,
  deleteDepartment,
  deleteEmployee,
  deleteHoliday,
  deleteTimeEntry,
  type EmployeeInput,
  type HolidayInput,
  HrError,
  type LeaveRequestInput,
  type LeaveTypeInput,
  recordLeave,
  requestLeave,
  type SettingsInput,
  saveDepartment,
  saveLeaveType,
  setLeaveTypeStatus,
  type TimeEntryInput,
  updateEmployee,
  updateHrSettings,
  updateTimeEntry,
} from "@templates/hr"

export type HrResult =
  | { ok: true; id?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

async function ctxWith(permission: Permissions) {
  const { user, orgId } = await requirePermission(permission)
  return { orgId, user: { id: user.id, name: user.name, email: user.email } }
}

async function run(fn: () => Promise<{ id?: string } | undefined | void>): Promise<HrResult> {
  try {
    const r = await fn()
    return { ok: true, ...(r ?? {}) }
  } catch (e) {
    if (e instanceof HrError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors }
    if (e instanceof AuthError) return { ok: false, error: "You don't have permission to do that." }
    throw e
  }
}

const self = { hr: ["self"] } satisfies Permissions
const manage = { hr: ["manage"] } satisfies Permissions

// ---------- Self-service ----------

export async function clockInAction(note: string) {
  return run(async () => ({ id: (await clockIn(await ctxWith(self), note))?.id }))
}

export async function clockOutAction(note: string) {
  return run(async () => ({ id: (await clockOut(await ctxWith(self), note)).id }))
}

export async function requestLeaveAction(input: LeaveRequestInput) {
  return run(async () => ({ id: (await requestLeave(await ctxWith(self), input)).id }))
}

/** People cancel their own requests; HR can cancel anyone's. */
export async function cancelLeaveAction(id: string) {
  return run(async () => {
    const ctx = await ctxWith(self)
    await cancelLeave(ctx, id, { asManager: await can(manage) })
  })
}

// ---------- Approvers ----------

export async function decideLeaveAction(id: string, approve: boolean, note: string) {
  return run(async () => {
    await decideLeave(await ctxWith({ hr: ["approve"] }), id, { approve, note })
  })
}

// ---------- HR managers ----------

export async function saveEmployeeAction(id: string | null, input: EmployeeInput) {
  return run(async () => {
    const ctx = await ctxWith(manage)
    return { id: (id ? await updateEmployee(ctx, id, input) : await createEmployee(ctx, input)).id }
  })
}

export async function deleteEmployeeAction(id: string) {
  return run(async () => {
    await deleteEmployee(await ctxWith(manage), id)
  })
}

export async function recordLeaveAction(employeeId: string, input: LeaveRequestInput) {
  return run(async () => ({ id: (await recordLeave(await ctxWith(manage), employeeId, input)).id }))
}

export async function addAdjustmentAction(employeeId: string, input: AdjustmentInput) {
  return run(async () => {
    await addLeaveAdjustment(await ctxWith(manage), employeeId, input)
  })
}

export async function saveTimeEntryAction(
  employeeId: string,
  entryId: string | null,
  input: TimeEntryInput,
) {
  return run(async () => {
    const ctx = await ctxWith(manage)
    return {
      id: (entryId
        ? await updateTimeEntry(ctx, entryId, input)
        : await addTimeEntry(ctx, employeeId, input)
      )?.id,
    }
  })
}

export async function deleteTimeEntryAction(id: string) {
  return run(async () => {
    await deleteTimeEntry(await ctxWith(manage), id)
  })
}

export async function saveHrSettingsAction(input: SettingsInput) {
  return run(async () => {
    await updateHrSettings(await ctxWith(manage), input)
  })
}

export async function saveDepartmentAction(id: string | null, input: DepartmentInput) {
  return run(async () => ({ id: (await saveDepartment(await ctxWith(manage), id, input)).id }))
}

export async function deleteDepartmentAction(id: string) {
  return run(async () => {
    await deleteDepartment(await ctxWith(manage), id)
  })
}

export async function saveLeaveTypeAction(id: string | null, input: LeaveTypeInput) {
  return run(async () => ({ id: (await saveLeaveType(await ctxWith(manage), id, input)).id }))
}

export async function setLeaveTypeStatusAction(id: string, archived: boolean) {
  return run(async () => {
    await setLeaveTypeStatus(await ctxWith(manage), id, archived ? "archived" : "active")
  })
}

export async function addHolidayAction(input: HolidayInput) {
  return run(async () => ({ id: (await addHoliday(await ctxWith(manage), input))?.id }))
}

export async function deleteHolidayAction(id: string) {
  return run(async () => {
    await deleteHoliday(await ctxWith(manage), id)
  })
}
