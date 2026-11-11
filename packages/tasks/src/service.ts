import "server-only"

import { audit } from "@templates/audit"
import { db } from "@templates/db"
import {
  member,
  project,
  type Task,
  task,
  taskChecklistItem,
  taskComment,
  user,
} from "@templates/db/schema"
import { notify } from "@templates/notifications"
import { and, asc, count, desc, eq, ilike, isNull, max, ne, or, type SQL, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { z } from "zod"

import {
  checklistTextSchema,
  commentSchema,
  fieldErrors,
  MAX_CHECKLIST_ITEMS,
  nextDue,
  type ProjectInput,
  projectInputSchema,
  type TaskFilter,
  type TaskInput,
  type TaskStatus,
  taskFilterSchema,
  taskInputSchema,
  today,
} from "./definitions"

export type TasksContext = { orgId: string; user: { id: string; name: string; email: string } }

export class TaskError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(message)
  }
}

const isUuid = (s: string) => z.uuid().safeParse(s).success
const notFound = () => new TaskError("Not found", 404)
const invalid = (fieldErrors: Record<string, string>) =>
  new TaskError("Please fix the highlighted fields.", 400, fieldErrors)

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input)
  if (!r.success) throw invalid(fieldErrors(r.error))
  return r.data
}

const likeTerm = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

// ---------- Ownership: every lookup is scoped to ctx.orgId ----------

async function ownTask(ctx: Pick<TasksContext, "orgId">, id: string) {
  if (!isUuid(id)) throw notFound()
  const [row] = await db
    .select()
    .from(task)
    .where(and(eq(task.id, id), eq(task.orgId, ctx.orgId)))
  if (!row) throw notFound()
  return row
}

async function ownProject(ctx: Pick<TasksContext, "orgId">, id: string) {
  if (!isUuid(id)) throw notFound()
  const [row] = await db
    .select()
    .from(project)
    .where(and(eq(project.id, id), eq(project.orgId, ctx.orgId)))
  if (!row) throw notFound()
  return row
}

/** Assignees must be members of this org. */
async function assertMember(ctx: Pick<TasksContext, "orgId">, userId: string | null) {
  if (!userId) return
  const [m] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, ctx.orgId), eq(member.userId, userId)))
  if (!m) throw invalid({ assigneeId: "Choose someone in this organization" })
}

/** The project must be this org's and still active. */
async function assertProject(ctx: Pick<TasksContext, "orgId">, projectId: string | null) {
  if (!projectId) return
  const p = await ownProject(ctx, projectId).catch(() => null)
  if (!p) throw invalid({ projectId: "Choose a project from the list" })
  if (p.status === "archived") throw invalid({ projectId: "That project is archived" })
}

export async function taskMembers(ctx: Pick<TasksContext, "orgId">) {
  return db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, ctx.orgId))
    .orderBy(asc(user.name))
}

async function notifyAssignee(ctx: TasksContext, t: Pick<Task, "id" | "title" | "assigneeId">) {
  if (!t.assigneeId || t.assigneeId === ctx.user.id) return
  await notify({
    orgId: ctx.orgId,
    to: [t.assigneeId],
    type: "task.assigned",
    title: `New task: ${t.title}`,
    body: `Assigned by ${ctx.user.name}.`,
    link: `/tasks/${t.id}`,
  })
}

// ---------- Listing ----------

const assignee = alias(user, "assignee")

/** Priority as a sortable number: urgent first. */
const priorityRank = sql<number>`case ${task.priority} when 'urgent' then 3 when 'high' then 2 when 'normal' then 1 else 0 end`

export async function listTasks(
  ctx: Pick<TasksContext, "orgId"> & { userId?: string },
  f: TaskFilter = {},
) {
  const filter = taskFilterSchema.parse(f)
  const where: SQL[] = [eq(task.orgId, ctx.orgId)]
  const who = filter.assignee ?? "me"
  if (who === "me" && ctx.userId) where.push(eq(task.assigneeId, ctx.userId))
  else if (who === "none") where.push(isNull(task.assigneeId))
  else if (who !== "all" && who !== "me") where.push(eq(task.assigneeId, who))
  const status = filter.status ?? "open"
  if (status === "open") where.push(ne(task.status, "done"))
  else where.push(eq(task.status, status))
  if (filter.priority) where.push(eq(task.priority, filter.priority))
  if (filter.project) where.push(eq(task.projectId, filter.project))
  if (filter.q) {
    const term = likeTerm(filter.q)
    const search = or(ilike(task.title, term), ilike(task.description, term))
    if (search) where.push(search)
  }

  const checklist = db
    .select({
      taskId: taskChecklistItem.taskId,
      total: count().as("total"),
      done: sql<number>`count(*) filter (where ${taskChecklistItem.done})`.as("done"),
    })
    .from(taskChecklistItem)
    .where(eq(taskChecklistItem.orgId, ctx.orgId))
    .groupBy(taskChecklistItem.taskId)
    .as("checklist")
  const comments = db
    .select({ taskId: taskComment.taskId, n: count().as("n") })
    .from(taskComment)
    .where(eq(taskComment.orgId, ctx.orgId))
    .groupBy(taskComment.taskId)
    .as("comments")

  return db
    .select({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      dueOn: task.dueOn,
      recurrence: task.recurrence,
      completedAt: task.completedAt,
      assigneeId: task.assigneeId,
      assigneeName: assignee.name,
      projectId: task.projectId,
      projectName: project.name,
      checklistTotal: sql<number>`coalesce(${checklist.total}, 0)::int`,
      checklistDone: sql<number>`coalesce(${checklist.done}, 0)::int`,
      comments: sql<number>`coalesce(${comments.n}, 0)::int`,
    })
    .from(task)
    .leftJoin(assignee, eq(assignee.id, task.assigneeId))
    .leftJoin(project, eq(project.id, task.projectId))
    .leftJoin(checklist, eq(checklist.taskId, task.id))
    .leftJoin(comments, eq(comments.taskId, task.id))
    .where(and(...where))
    .orderBy(
      status === "done" ? desc(task.completedAt) : sql`${task.dueOn} asc nulls last`,
      desc(priorityRank),
      desc(task.createdAt),
    )
    .limit(500)
}

export type TaskListItem = Awaited<ReturnType<typeof listTasks>>[number]

/** Open tasks assigned to a user, by due bucket counts. Handy for a dashboard tile. */
export async function myTaskCounts(ctx: Pick<TasksContext, "orgId">, userId: string, tz?: string) {
  const t = today(tz)
  const [row] = await db
    .select({
      open: count(),
      overdue: sql<number>`count(*) filter (where ${task.dueOn} < ${t})::int`,
      dueToday: sql<number>`count(*) filter (where ${task.dueOn} = ${t})::int`,
    })
    .from(task)
    .where(and(eq(task.orgId, ctx.orgId), eq(task.assigneeId, userId), ne(task.status, "done")))
  return row ?? { open: 0, overdue: 0, dueToday: 0 }
}

// ---------- One task ----------

export async function getTask(ctx: Pick<TasksContext, "orgId">, id: string) {
  const t = await ownTask(ctx, id)
  const author = alias(user, "author")
  const creator = alias(user, "creator")
  const [people, proj, checklist, comments] = await Promise.all([
    db
      .select({ assigneeName: assignee.name, creatorName: creator.name })
      .from(task)
      .leftJoin(assignee, eq(assignee.id, task.assigneeId))
      .leftJoin(creator, eq(creator.id, task.createdBy))
      .where(eq(task.id, t.id))
      .then((r) => r[0]),
    t.projectId
      ? db
          .select({ id: project.id, name: project.name, status: project.status })
          .from(project)
          .where(eq(project.id, t.projectId))
          .then((r) => r[0] ?? null)
      : null,
    db
      .select()
      .from(taskChecklistItem)
      .where(and(eq(taskChecklistItem.taskId, t.id), eq(taskChecklistItem.orgId, ctx.orgId)))
      .orderBy(asc(taskChecklistItem.position), asc(taskChecklistItem.createdAt)),
    db
      .select({
        id: taskComment.id,
        body: taskComment.body,
        createdAt: taskComment.createdAt,
        authorId: taskComment.authorId,
        authorName: author.name,
      })
      .from(taskComment)
      .leftJoin(author, eq(author.id, taskComment.authorId))
      .where(and(eq(taskComment.taskId, t.id), eq(taskComment.orgId, ctx.orgId)))
      .orderBy(asc(taskComment.createdAt))
      .limit(500),
  ])
  return {
    task: t,
    assigneeName: people?.assigneeName ?? null,
    creatorName: people?.creatorName ?? null,
    project: proj,
    checklist,
    comments,
  }
}

export async function createTask(ctx: TasksContext, input: TaskInput) {
  const v = parse(taskInputSchema, input)
  await Promise.all([assertMember(ctx, v.assigneeId), assertProject(ctx, v.projectId)])
  const [row] = await db
    .insert(task)
    .values({
      ...v,
      orgId: ctx.orgId,
      completedAt: v.status === "done" ? new Date() : null,
      createdBy: ctx.user.id,
    })
    .returning()
  if (!row) throw new Error("insert failed")
  await notifyAssignee(ctx, row)
  return row
}

export async function updateTask(ctx: TasksContext, id: string, input: TaskInput) {
  const before = await ownTask(ctx, id)
  const v = parse(taskInputSchema, input)
  await Promise.all([
    v.assigneeId !== before.assigneeId ? assertMember(ctx, v.assigneeId) : null,
    // Keeping a task in a project that was archived later is fine; moving one into it isn't.
    v.projectId !== before.projectId ? assertProject(ctx, v.projectId) : null,
  ])
  const { status, ...rest } = v
  await db
    .update(task)
    .set(rest)
    .where(and(eq(task.id, id), eq(task.orgId, ctx.orgId)))
  if (v.assigneeId !== before.assigneeId) await notifyAssignee(ctx, { ...before, ...rest })
  if (status !== before.status) return setTaskStatus(ctx, id, status)
  return ownTask(ctx, id)
}

/**
 * Moves a task to a status. Completing stamps `completedAt`, tells the creator
 * (if someone else finished it) and, for a repeating task, creates the next one.
 */
export async function setTaskStatus(ctx: TasksContext, id: string, status: TaskStatus) {
  const before = await ownTask(ctx, id)
  if (before.status === status) return { task: before, next: null }

  const result = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(task)
      .set({ status, completedAt: status === "done" ? new Date() : null })
      .where(and(eq(task.id, id), eq(task.orgId, ctx.orgId)))
      .returning()
    if (!updated) throw notFound()

    let next: Task | null = null
    if (status === "done" && updated.recurrence !== "none" && !updated.nextTaskId) {
      const from = updated.dueOn ?? today()
      const [created] = await tx
        .insert(task)
        .values({
          orgId: updated.orgId,
          projectId: updated.projectId,
          title: updated.title,
          description: updated.description,
          priority: updated.priority,
          assigneeId: updated.assigneeId,
          dueOn: nextDue(from, updated.recurrence, updated.recurrenceInterval),
          recurrence: updated.recurrence,
          recurrenceInterval: updated.recurrenceInterval,
          createdBy: updated.createdBy,
        })
        .returning()
      if (!created) throw new Error("insert failed")
      next = created
      // The checklist carries over, unticked.
      const items = await tx
        .select()
        .from(taskChecklistItem)
        .where(eq(taskChecklistItem.taskId, updated.id))
      if (items.length)
        await tx.insert(taskChecklistItem).values(
          items.map((i) => ({
            orgId: i.orgId,
            taskId: created.id,
            text: i.text,
            position: i.position,
          })),
        )
      await tx.update(task).set({ nextTaskId: created.id }).where(eq(task.id, updated.id))
    }
    return { task: updated, next }
  })

  if (status === "done" && before.createdBy && before.createdBy !== ctx.user.id)
    await notify({
      orgId: ctx.orgId,
      to: [before.createdBy],
      type: "task.completed",
      title: `Done: ${before.title}`,
      body: `Completed by ${ctx.user.name}.`,
      link: `/tasks/${id}`,
    })
  return result
}

/** Creators can delete their own tasks; `canDeleteAny` (admins) can delete any. */
export async function deleteTask(ctx: TasksContext, id: string, opts: { canDeleteAny: boolean }) {
  const t = await ownTask(ctx, id)
  if (t.createdBy !== ctx.user.id && !opts.canDeleteAny)
    throw new TaskError("You can only delete tasks you created.", 403)
  await db.delete(task).where(and(eq(task.id, id), eq(task.orgId, ctx.orgId)))
  await audit(ctx, "task.deleted", `Deleted task ${t.title}`, { target: { type: "task", id } })
}

// ---------- Checklist ----------

async function ownItem(ctx: Pick<TasksContext, "orgId">, id: string) {
  if (!isUuid(id)) throw notFound()
  const [row] = await db
    .select()
    .from(taskChecklistItem)
    .where(and(eq(taskChecklistItem.id, id), eq(taskChecklistItem.orgId, ctx.orgId)))
  if (!row) throw notFound()
  return row
}

export async function addChecklistItem(ctx: TasksContext, taskId: string, text: string) {
  const t = await ownTask(ctx, taskId)
  const r = checklistTextSchema.safeParse(text)
  if (!r.success) throw invalid({ text: r.error.issues[0]?.message ?? "Invalid" })
  const [stats] = await db
    .select({ n: count(), last: max(taskChecklistItem.position) })
    .from(taskChecklistItem)
    .where(eq(taskChecklistItem.taskId, t.id))
  if ((stats?.n ?? 0) >= MAX_CHECKLIST_ITEMS)
    throw new TaskError(`A checklist can have at most ${MAX_CHECKLIST_ITEMS} items.`, 409)
  const [row] = await db
    .insert(taskChecklistItem)
    .values({ orgId: ctx.orgId, taskId: t.id, text: r.data, position: (stats?.last ?? -1) + 1 })
    .returning()
  return row
}

export async function setChecklistItemDone(ctx: TasksContext, id: string, done: boolean) {
  await ownItem(ctx, id)
  await db
    .update(taskChecklistItem)
    .set({ done })
    .where(and(eq(taskChecklistItem.id, id), eq(taskChecklistItem.orgId, ctx.orgId)))
}

export async function deleteChecklistItem(ctx: TasksContext, id: string) {
  await ownItem(ctx, id)
  await db
    .delete(taskChecklistItem)
    .where(and(eq(taskChecklistItem.id, id), eq(taskChecklistItem.orgId, ctx.orgId)))
}

// ---------- Comments ----------

export async function addComment(ctx: TasksContext, taskId: string, body: string) {
  const t = await ownTask(ctx, taskId)
  const r = commentSchema.safeParse(body)
  if (!r.success) throw invalid({ body: r.error.issues[0]?.message ?? "Invalid" })
  const [row] = await db
    .insert(taskComment)
    .values({ orgId: ctx.orgId, taskId: t.id, body: r.data, authorId: ctx.user.id })
    .returning()
  const to = [t.assigneeId, t.createdBy].filter((u): u is string => !!u && u !== ctx.user.id)
  await notify({
    orgId: ctx.orgId,
    to,
    type: "task.commented",
    title: `${ctx.user.name} commented on ${t.title}`,
    body: r.data.length > 200 ? `${r.data.slice(0, 200)}…` : r.data,
    link: `/tasks/${t.id}`,
  })
  return row
}

/** Authors delete their own comments; `canDeleteAny` (admins) can delete any. */
export async function deleteComment(
  ctx: TasksContext,
  id: string,
  opts: { canDeleteAny: boolean },
) {
  if (!isUuid(id)) throw notFound()
  const [c] = await db
    .select()
    .from(taskComment)
    .where(and(eq(taskComment.id, id), eq(taskComment.orgId, ctx.orgId)))
  if (!c) throw notFound()
  if (c.authorId !== ctx.user.id && !opts.canDeleteAny)
    throw new TaskError("You can only delete your own comments.", 403)
  await db.delete(taskComment).where(and(eq(taskComment.id, id), eq(taskComment.orgId, ctx.orgId)))
}

// ---------- Projects (managing them needs `project: ["manage"]`) ----------

export async function listProjects(
  ctx: Pick<TasksContext, "orgId">,
  opts: { includeArchived?: boolean } = {},
) {
  const stats = db
    .select({
      projectId: task.projectId,
      total: count().as("total"),
      done: sql<number>`count(*) filter (where ${task.status} = 'done')`.as("done"),
      overdue:
        sql<number>`count(*) filter (where ${task.status} <> 'done' and ${task.dueOn} < current_date)`.as(
          "overdue",
        ),
    })
    .from(task)
    .where(eq(task.orgId, ctx.orgId))
    .groupBy(task.projectId)
    .as("stats")
  return db
    .select({
      id: project.id,
      name: project.name,
      description: project.description,
      status: project.status,
      updatedAt: project.updatedAt,
      total: sql<number>`coalesce(${stats.total}, 0)::int`,
      done: sql<number>`coalesce(${stats.done}, 0)::int`,
      overdue: sql<number>`coalesce(${stats.overdue}, 0)::int`,
    })
    .from(project)
    .leftJoin(stats, eq(stats.projectId, project.id))
    .where(
      and(
        eq(project.orgId, ctx.orgId),
        opts.includeArchived ? undefined : eq(project.status, "active"),
      ),
    )
    .orderBy(asc(project.status), desc(project.updatedAt))
}

export const getProject = ownProject

/** Every task in a project, for its board. */
export async function projectTasks(ctx: Pick<TasksContext, "orgId">, projectId: string) {
  const p = await ownProject(ctx, projectId)
  const rows = await db
    .select({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      dueOn: task.dueOn,
      assigneeName: assignee.name,
      completedAt: task.completedAt,
    })
    .from(task)
    .leftJoin(assignee, eq(assignee.id, task.assigneeId))
    .where(and(eq(task.projectId, p.id), eq(task.orgId, ctx.orgId)))
    .orderBy(sql`${task.dueOn} asc nulls last`, desc(priorityRank), desc(task.createdAt))
    .limit(1000)
  return { project: p, tasks: rows }
}

export async function createProject(ctx: TasksContext, input: ProjectInput) {
  const v = parse(projectInputSchema, input)
  const [row] = await db
    .insert(project)
    .values({ ...v, orgId: ctx.orgId, createdBy: ctx.user.id })
    .returning()
  if (!row) throw new Error("insert failed")
  await audit(ctx, "project.created", `Created project ${row.name}`, {
    target: { type: "project", id: row.id },
  })
  return row
}

export async function updateProject(ctx: TasksContext, id: string, input: ProjectInput) {
  await ownProject(ctx, id)
  const v = parse(projectInputSchema, input)
  const [row] = await db
    .update(project)
    .set(v)
    .where(and(eq(project.id, id), eq(project.orgId, ctx.orgId)))
    .returning()
  return row
}

export async function setProjectStatus(
  ctx: TasksContext,
  id: string,
  status: "active" | "archived",
) {
  const p = await ownProject(ctx, id)
  if (p.status === status) return
  await db
    .update(project)
    .set({ status })
    .where(and(eq(project.id, id), eq(project.orgId, ctx.orgId)))
  await audit(
    ctx,
    `project.${status === "archived" ? "archived" : "restored"}`,
    `${status === "archived" ? "Archived" : "Restored"} project ${p.name}`,
    { target: { type: "project", id } },
  )
}

/** Deletes the project and every task in it. */
export async function deleteProject(ctx: TasksContext, id: string) {
  const p = await ownProject(ctx, id)
  const [n] = await db.select({ n: count() }).from(task).where(eq(task.projectId, p.id))
  await db.delete(project).where(and(eq(project.id, id), eq(project.orgId, ctx.orgId)))
  await audit(ctx, "project.deleted", `Deleted project ${p.name} and its ${n?.n ?? 0} tasks`, {
    target: { type: "project", id },
  })
}
