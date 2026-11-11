import { listAuditLog } from "@templates/audit"
import { db } from "@templates/db"
import { TASK_STATUSES as DB_STATUSES, taskChecklistItem, taskComment } from "@templates/db/schema"
import { listNotifications } from "@templates/notifications"
import {
  addChecklistItem,
  addComment,
  addDays,
  addMonths,
  createProject,
  createTask,
  deleteComment,
  deleteProject,
  deleteTask,
  dueBucket,
  fieldErrors,
  getTask,
  listProjects,
  listTasks,
  MAX_CHECKLIST_ITEMS,
  myTaskCounts,
  nextDue,
  projectTasks,
  setChecklistItemDone,
  setProjectStatus,
  setTaskStatus,
  TASK_STATUSES,
  taskInputSchema,
  today,
  updateTask,
} from "@templates/tasks"
import { eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { addMember, newOrgOwner } from "../setup/client"

type Person = { id: string; name: string; email: string }
const ctxOf = (orgId: string, u: Person) => ({
  orgId,
  user: { id: u.id, name: u.name, email: u.email },
})

async function setup() {
  const org = await newOrgOwner("Acme")
  return { org, ctx: ctxOf(org.orgId, org) }
}

const inbox = async (userId: string, orgId: string) =>
  (await listNotifications({ userId, orgId })).map((n) => n.type)

describe("dates", () => {
  it("adds months without overflowing short months", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28")
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29")
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15")
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28")
  })

  it("computes the next occurrence", () => {
    expect(nextDue("2026-11-30", "daily", 2)).toBe("2026-12-02")
    expect(nextDue("2026-11-11", "weekly", 1)).toBe("2026-11-18")
    expect(nextDue("2026-10-31", "monthly", 1)).toBe("2026-11-30")
  })

  it("buckets due dates against today", () => {
    const t = "2026-11-11"
    expect(dueBucket(null, t)).toBe("none")
    expect(dueBucket("2026-11-10", t)).toBe("overdue")
    expect(dueBucket(t, t)).toBe("today")
    expect(dueBucket(addDays(t, 7), t)).toBe("week")
    expect(dueBucket(addDays(t, 8), t)).toBe("later")
  })

  it("reads today in a given timezone", () => {
    const instant = new Date("2026-11-11T20:00:00Z")
    expect(today("UTC", instant)).toBe("2026-11-11")
    expect(today("Asia/Manila", instant)).toBe("2026-11-12")
  })
})

describe("validation", () => {
  it.each([
    [{ title: "  " }, "title", "Give the task a title"],
    [{ title: "x", dueOn: "2026-02-30" }, "dueOn", "Pick a date"],
    [{ title: "x", recurrence: "weekly" }, "dueOn", "Repeating tasks need a due date"],
    [
      { title: "x", recurrence: "daily", dueOn: "2026-11-11", recurrenceInterval: 0 },
      "recurrenceInterval",
      "At least 1",
    ],
    [{ title: "x", assigneeId: "nope" }, "assigneeId", "Choose someone from the list"],
  ])("rejects %j", (input, field, message) => {
    const r = taskInputSchema.safeParse(input)
    expect(r.success).toBe(false)
    if (!r.success) expect(fieldErrors(r.error)[field]).toBe(message)
  })

  it("keeps status lists in sync between the module and the schema", () => {
    expect(TASK_STATUSES).toEqual(DB_STATUSES)
  })
})

describe("tasks", () => {
  it("shows my open tasks by default, soonest and most urgent first", async () => {
    const { org, ctx } = await setup()
    const rep = await addMember(org, "member")
    const mine = (title: string, extra = {}) =>
      createTask(ctx, { title, assigneeId: org.id, ...extra })
    await mine("Later", { dueOn: "2030-01-10" })
    await mine("Soon, normal", { dueOn: "2030-01-01" })
    await mine("Soon, urgent", { dueOn: "2030-01-01", priority: "urgent" })
    await mine("Whenever")
    const done = await mine("Finished")
    await setTaskStatus(ctx, done.id, "done")
    await createTask(ctx, { title: "Theirs", assigneeId: rep.id })

    const titles = (await listTasks({ ...ctx, userId: org.id })).map((t) => t.title)
    expect(titles).toEqual(["Soon, urgent", "Soon, normal", "Later", "Whenever"])
    expect(
      (await listTasks({ ...ctx, userId: org.id }, { status: "done" })).map((t) => t.title),
    ).toEqual(["Finished"])
    expect((await listTasks(ctx, { assignee: "all" })).length).toBe(5)
    expect((await listTasks(ctx, { assignee: rep.id })).map((t) => t.title)).toEqual(["Theirs"])
  })

  it("searches with LIKE characters taken literally", async () => {
    const { ctx } = await setup()
    await createTask(ctx, { title: "Raise prices 10%" })
    await createTask(ctx, { title: "Raise prices 100 units" })
    const r = await listTasks(ctx, { assignee: "all", q: "10%" })
    expect(r.map((t) => t.title)).toEqual(["Raise prices 10%"])
  })

  it("only assigns to members, and tells the assignee", async () => {
    const { org, ctx } = await setup()
    const rep = await addMember(org, "member")
    const stranger = await newOrgOwner("Other")
    await expect(createTask(ctx, { title: "x", assigneeId: stranger.id })).rejects.toMatchObject({
      status: 400,
      fieldErrors: { assigneeId: "Choose someone in this organization" },
    })
    const t = await createTask(ctx, { title: "Count stock", assigneeId: rep.id })
    expect(await inbox(rep.id, org.orgId)).toContain("task.assigned")
    // Assigning yourself doesn't notify you.
    await updateTask(ctx, t.id, { title: "Count stock", assigneeId: org.id })
    expect(await inbox(org.id, org.orgId)).not.toContain("task.assigned")
  })

  it("stamps completion and tells the creator when someone else finishes", async () => {
    const { org, ctx } = await setup()
    const rep = await addMember(org, "member")
    const repCtx = ctxOf(org.orgId, rep)
    const t = await createTask(ctx, { title: "Call supplier", assigneeId: rep.id })
    const { task: done } = await setTaskStatus(repCtx, t.id, "done")
    expect(done.completedAt).toBeInstanceOf(Date)
    expect(await inbox(org.id, org.orgId)).toContain("task.completed")
    const { task: reopened } = await setTaskStatus(repCtx, t.id, "todo")
    expect(reopened.completedAt).toBeNull()
  })

  it("creates the next occurrence of a repeating task once, with a fresh checklist", async () => {
    const { ctx } = await setup()
    const t = await createTask(ctx, {
      title: "Payroll",
      dueOn: "2026-01-31",
      recurrence: "monthly",
    })
    const item = await addChecklistItem(ctx, t.id, "Export timesheets")
    if (!item) throw new Error("no item")
    await setChecklistItemDone(ctx, item.id, true)

    const { next } = await setTaskStatus(ctx, t.id, "done")
    expect(next).toMatchObject({ title: "Payroll", dueOn: "2026-02-28", status: "todo" })
    if (!next) throw new Error("no next")
    const nextItems = await db
      .select()
      .from(taskChecklistItem)
      .where(eq(taskChecklistItem.taskId, next.id))
    expect(nextItems).toMatchObject([{ text: "Export timesheets", done: false }])

    // Reopening and completing again doesn't create a second copy.
    await setTaskStatus(ctx, t.id, "todo")
    const again = await setTaskStatus(ctx, t.id, "done")
    expect(again.next).toBeNull()
    expect((await listTasks(ctx, { assignee: "all", q: "Payroll" })).length).toBe(1)
  })

  it("lets creators delete their own tasks, admins any", async () => {
    const { org, ctx } = await setup()
    const rep = await addMember(org, "member")
    const repCtx = ctxOf(org.orgId, rep)
    const ownerTask = await createTask(ctx, { title: "Owner's" })
    const repTask = await createTask(repCtx, { title: "Rep's" })
    await expect(deleteTask(repCtx, ownerTask.id, { canDeleteAny: false })).rejects.toMatchObject({
      status: 403,
    })
    await deleteTask(repCtx, repTask.id, { canDeleteAny: false })
    await deleteTask(ctx, ownerTask.id, { canDeleteAny: true })
    const log = await listAuditLog(org.orgId, { page: 1 })
    expect(log.rows.filter((r) => r.action === "task.deleted")).toHaveLength(2)
  })

  it("counts my open, overdue and due-today tasks", async () => {
    const { org, ctx } = await setup()
    const t = today("UTC")
    await createTask(ctx, { title: "a", assigneeId: org.id, dueOn: addDays(t, -2) })
    await createTask(ctx, { title: "b", assigneeId: org.id, dueOn: t })
    await createTask(ctx, { title: "c", assigneeId: org.id })
    expect(await myTaskCounts(ctx, org.id, "UTC")).toEqual({ open: 3, overdue: 1, dueToday: 1 })
  })
})

describe("checklist and comments", () => {
  it("caps the checklist", async () => {
    const { ctx } = await setup()
    const t = await createTask(ctx, { title: "Big job" })
    for (let i = 0; i < MAX_CHECKLIST_ITEMS; i++) await addChecklistItem(ctx, t.id, `Step ${i}`)
    await expect(addChecklistItem(ctx, t.id, "One more")).rejects.toMatchObject({ status: 409 })
    const { checklist } = await getTask(ctx, t.id)
    expect(checklist[0]?.text).toBe("Step 0")
    expect(checklist.at(-1)?.text).toBe(`Step ${MAX_CHECKLIST_ITEMS - 1}`)
  })

  it("notifies the assignee and creator about comments, but not the author", async () => {
    const { org, ctx } = await setup()
    const rep = await addMember(org, "member")
    const other = await addMember(org, "member")
    const t = await createTask(ctx, { title: "Fix sign", assigneeId: rep.id })
    await addComment(ctxOf(org.orgId, other), t.id, "Ladder is in the back.")
    expect(await inbox(rep.id, org.orgId)).toContain("task.commented")
    expect(await inbox(org.id, org.orgId)).toContain("task.commented")
    expect(await inbox(other.id, org.orgId)).not.toContain("task.commented")
  })

  it("lets authors delete their own comments only", async () => {
    const { org, ctx } = await setup()
    const rep = await addMember(org, "member")
    const repCtx = ctxOf(org.orgId, rep)
    const t = await createTask(ctx, { title: "x" })
    const c = await addComment(ctx, t.id, "Owner's note")
    if (!c) throw new Error("no comment")
    await expect(deleteComment(repCtx, c.id, { canDeleteAny: false })).rejects.toMatchObject({
      status: 403,
    })
    await deleteComment(ctx, c.id, { canDeleteAny: false })
    expect(await db.select().from(taskComment).where(eq(taskComment.taskId, t.id))).toHaveLength(0)
  })
})

describe("projects", () => {
  it("tracks progress, refuses new tasks once archived, and deletes its tasks", async () => {
    const { org, ctx } = await setup()
    const p = await createProject(ctx, { name: "Store opening" })
    const a = await createTask(ctx, { title: "Sign lease", projectId: p.id })
    await createTask(ctx, { title: "Hire staff", projectId: p.id, dueOn: "2020-01-01" })
    await setTaskStatus(ctx, a.id, "done")

    expect((await listProjects(ctx))[0]).toMatchObject({ total: 2, done: 1, overdue: 1 })
    expect((await projectTasks(ctx, p.id)).tasks).toHaveLength(2)

    await setProjectStatus(ctx, p.id, "archived")
    expect(await listProjects(ctx)).toHaveLength(0)
    await expect(createTask(ctx, { title: "Late", projectId: p.id })).rejects.toMatchObject({
      fieldErrors: { projectId: "That project is archived" },
    })

    await deleteProject(ctx, p.id)
    expect(await listTasks(ctx, { assignee: "all", status: "done" })).toHaveLength(0)
    const log = await listAuditLog(org.orgId, { page: 1 })
    expect(log.rows.find((r) => r.action === "project.deleted")?.summary).toContain("2 tasks")
  })
})

describe("org isolation", () => {
  it("can't read, change or attach to another org's tasks and projects", async () => {
    const a = await setup()
    const b = await setup()
    const p = await createProject(a.ctx, { name: "Secret" })
    const t = await createTask(a.ctx, { title: "Hidden", projectId: p.id })
    const nf = { status: 404 }

    await expect(getTask(b.ctx, t.id)).rejects.toMatchObject(nf)
    await expect(updateTask(b.ctx, t.id, { title: "x" })).rejects.toMatchObject(nf)
    await expect(setTaskStatus(b.ctx, t.id, "done")).rejects.toMatchObject(nf)
    await expect(deleteTask(b.ctx, t.id, { canDeleteAny: true })).rejects.toMatchObject(nf)
    await expect(addChecklistItem(b.ctx, t.id, "x")).rejects.toMatchObject(nf)
    await expect(addComment(b.ctx, t.id, "x")).rejects.toMatchObject(nf)
    await expect(projectTasks(b.ctx, p.id)).rejects.toMatchObject(nf)
    await expect(deleteProject(b.ctx, p.id)).rejects.toMatchObject(nf)
    // Org B can't file a task under org A's project.
    await expect(createTask(b.ctx, { title: "x", projectId: p.id })).rejects.toMatchObject({
      fieldErrors: { projectId: "Choose a project from the list" },
    })
    expect(await listTasks(b.ctx, { assignee: "all" })).toHaveLength(0)
    expect(await listProjects(b.ctx)).toHaveLength(0)
  })

  it("the database refuses a checklist item pointing at another org's task", async () => {
    const a = await setup()
    const b = await setup()
    const t = await createTask(a.ctx, { title: "x" })
    await expect(
      db.insert(taskChecklistItem).values({ orgId: b.org.orgId, taskId: t.id, text: "sneaky" }),
    ).rejects.toThrow()
  })
})

describe("permissions", () => {
  it.each([
    ["member", { task: ["read", "write"], project: ["read"] }, true],
    ["member", { task: ["delete"] }, false],
    ["member", { project: ["manage"] }, false],
    ["admin", { task: ["delete"], project: ["manage"] }, true],
  ] as const)("%s → %j is %s", async (role, permissions, expected) => {
    const org = await newOrgOwner("Acme")
    const m = await addMember(org, role)
    expect(
      (await m.client.call("/organization/has-permission", { permissions })).data.success,
    ).toBe(expected)
  })
})
