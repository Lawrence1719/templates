"use server"

import { AuthError, can, requirePermission } from "@templates/auth/guards"
import type { Permissions } from "@templates/auth/permissions"
import {
  addChecklistItem,
  addComment,
  createProject,
  createTask,
  deleteChecklistItem,
  deleteComment,
  deleteProject,
  deleteTask,
  type ProjectInput,
  setChecklistItemDone,
  setProjectStatus,
  setTaskStatus,
  TASK_STATUSES,
  TaskError,
  type TaskInput,
  updateProject,
  updateTask,
} from "@templates/tasks"
import { redirect } from "next/navigation"
import { z } from "zod"

export type TaskResult =
  | { ok: true; id?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

async function ctxWith(permission: Permissions) {
  const { user, orgId } = await requirePermission(permission)
  return { orgId, user: { id: user.id, name: user.name, email: user.email } }
}

async function run(fn: () => Promise<{ id?: string } | undefined | void>): Promise<TaskResult> {
  try {
    const r = await fn()
    return { ok: true, ...(r ?? {}) }
  } catch (e) {
    if (e instanceof TaskError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors }
    if (e instanceof AuthError) return { ok: false, error: "You don't have permission to do that." }
    throw e
  }
}

const write = { task: ["write"] } satisfies Permissions
const manage = { project: ["manage"] } satisfies Permissions

// ---------- Tasks ----------

export async function createTaskAction(input: TaskInput) {
  return run(async () => ({ id: (await createTask(await ctxWith(write), input)).id }))
}

export async function updateTaskAction(id: string, input: TaskInput) {
  return run(async () => {
    await updateTask(await ctxWith(write), id, input)
  })
}

const statusSchema = z.enum(TASK_STATUSES)

export async function setTaskStatusAction(id: string, status: string) {
  return run(async () => {
    const s = statusSchema.safeParse(status)
    if (!s.success) throw new TaskError("Unknown status.", 400)
    await setTaskStatus(await ctxWith(write), id, s.data)
  })
}

export async function deleteTaskAction(id: string, then = "/tasks") {
  const r = await run(async () => {
    const ctx = await ctxWith(write)
    await deleteTask(ctx, id, { canDeleteAny: await can({ task: ["delete"] }) })
  })
  // Only ever redirect inside the app.
  if (r.ok) redirect(then.startsWith("/") && !then.startsWith("//") ? then : "/tasks")
  return r
}

// ---------- Checklist and comments ----------

export async function addChecklistItemAction(taskId: string, text: string) {
  return run(async () => {
    await addChecklistItem(await ctxWith(write), taskId, text)
  })
}

export async function setChecklistItemDoneAction(id: string, done: boolean) {
  return run(async () => {
    await setChecklistItemDone(await ctxWith(write), id, done === true)
  })
}

export async function deleteChecklistItemAction(id: string) {
  return run(async () => {
    await deleteChecklistItem(await ctxWith(write), id)
  })
}

export async function addCommentAction(taskId: string, body: string) {
  return run(async () => {
    await addComment(await ctxWith({ task: ["read"] }), taskId, body)
  })
}

export async function deleteCommentAction(id: string) {
  return run(async () => {
    const ctx = await ctxWith({ task: ["read"] })
    await deleteComment(ctx, id, { canDeleteAny: await can({ task: ["delete"] }) })
  })
}

// ---------- Projects ----------

export async function createProjectAction(input: ProjectInput) {
  return run(async () => ({ id: (await createProject(await ctxWith(manage), input)).id }))
}

export async function updateProjectAction(id: string, input: ProjectInput) {
  return run(async () => {
    await updateProject(await ctxWith(manage), id, input)
  })
}

export async function setProjectStatusAction(id: string, archived: boolean) {
  return run(async () => {
    await setProjectStatus(await ctxWith(manage), id, archived ? "archived" : "active")
  })
}

export async function deleteProjectAction(id: string) {
  const r = await run(async () => {
    await deleteProject(await ctxWith(manage), id)
  })
  if (r.ok) redirect("/projects")
  return r
}
