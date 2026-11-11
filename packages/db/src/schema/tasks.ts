import { sql } from "drizzle-orm"
import {
  boolean,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"

import { organization, user } from "./auth"

const orgId = () =>
  uuid("org_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" })

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
}

export const TASK_STATUSES = ["todo", "in_progress", "done"] as const
export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const
export const TASK_RECURRENCES = ["none", "daily", "weekly", "monthly"] as const

/** A group of related tasks, e.g. "Store opening" or "Q3 audit". */
export const project = pgTable(
  "project",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status", { enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("project_org_idx").on(t.orgId, t.status),
    // Lets tasks reference (id, org_id), so a task can't join another org's project.
    unique("project_id_org_uq").on(t.id, t.orgId),
  ],
)

export const task = pgTable(
  "task",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    /** Optional. Deleting a project deletes its tasks; archive it to keep them. */
    projectId: uuid("project_id"),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status", { enum: TASK_STATUSES }).notNull().default("todo"),
    priority: text("priority", { enum: TASK_PRIORITIES }).notNull().default("normal"),
    assigneeId: uuid("assignee_id").references(() => user.id, { onDelete: "set null" }),
    dueOn: date("due_on"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** Completing a recurring task creates the next one. */
    recurrence: text("recurrence", { enum: TASK_RECURRENCES }).notNull().default("none"),
    recurrenceInterval: integer("recurrence_interval").notNull().default(1),
    /** Set once the next occurrence exists, so re-completing doesn't create another. */
    nextTaskId: uuid("next_task_id"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("task_org_status_idx").on(t.orgId, t.status, t.dueOn),
    index("task_assignee_idx").on(t.orgId, t.assigneeId, t.status),
    index("task_project_idx").on(t.projectId),
    unique("task_id_org_uq").on(t.id, t.orgId),
    foreignKey({
      name: "task_project_fk",
      columns: [t.projectId, t.orgId],
      foreignColumns: [project.id, project.orgId],
    }).onDelete("cascade"),
  ],
)

export const taskChecklistItem = pgTable(
  "task_checklist_item",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    taskId: uuid("task_id").notNull(),
    text: text("text").notNull(),
    done: boolean("done").notNull().default(false),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("task_checklist_task_idx").on(t.taskId, t.position),
    foreignKey({
      name: "task_checklist_task_fk",
      columns: [t.taskId, t.orgId],
      foreignColumns: [task.id, task.orgId],
    }).onDelete("cascade"),
  ],
)

export const taskComment = pgTable(
  "task_comment",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    orgId: orgId(),
    taskId: uuid("task_id").notNull(),
    body: text("body").notNull(),
    authorId: uuid("author_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("task_comment_task_idx").on(t.taskId, t.createdAt),
    foreignKey({
      name: "task_comment_task_fk",
      columns: [t.taskId, t.orgId],
      foreignColumns: [task.id, task.orgId],
    }).onDelete("cascade"),
  ],
)

export type Project = typeof project.$inferSelect
export type Task = typeof task.$inferSelect
export type TaskStatus = (typeof TASK_STATUSES)[number]
export type TaskPriority = (typeof TASK_PRIORITIES)[number]
export type TaskRecurrence = (typeof TASK_RECURRENCES)[number]
export type TaskChecklistItem = typeof taskChecklistItem.$inferSelect
export type TaskComment = typeof taskComment.$inferSelect
