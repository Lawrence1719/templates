# Tasks & projects

Assign work, set due dates and priorities, track it on a project board, and let repeating chores create themselves.

## Features

- **My tasks** grouped into Overdue, Today, Next 7 days, Later and No due date, using the viewer's own timezone for "today"
- **Quick add**: type a title, optionally a date, press Enter; it's assigned to whoever's list you're on
- **Filters** for assignee (me, everyone, unassigned, a teammate), status, priority, project and text search; kept in the URL
- **Task page**: description, status, priority, assignee, due date, project, repeat rule, a **checklist** with progress, and **comments**
- **Repeating tasks**: daily, weekly or monthly, every _n_. Completing one creates the next with a fresh checklist; month ends are handled (Jan 31 → Feb 28)
- **Projects** with progress and overdue counts, a **board** (To do / In progress / Done) with a keyboard-friendly status select, archive and restore
- **Notifications**: `task.assigned`, `task.commented` (assignee and creator), `task.completed` (to the creator when someone else finishes)
- **Audit**: task deletions and project create/archive/restore/delete
- `myTaskCounts()` for a dashboard tile (open, overdue, due today)

## Security

| Threat                                  | Defense                                                                                                                                                                 |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reading or changing another org's tasks | Every query filters by the session's org; anything else is a 404                                                                                                        |
| Linking across orgs                     | Tasks reference `(project_id, org_id)`, checklist items and comments reference `(task_id, org_id)` with composite foreign keys, so the database refuses cross-org links |
| Filing work into the wrong place        | Assignees must be org members; tasks can't be added to another org's or an archived project                                                                             |
| Duplicate repeats                       | The next occurrence is created once, in a transaction; reopening and re-completing doesn't add another                                                                  |
| Deleting other people's work            | Members delete only tasks they created and comments they wrote; admins can delete any                                                                                   |
| Open redirects                          | The delete action only redirects to in-app paths                                                                                                                        |
| Abuse                                   | Lengths are capped; a checklist holds at most 50 items; lists return at most 500 rows                                                                                   |

## Permissions

`task: ["read", "write", "delete"]`, `project: ["read", "manage"]`. Members read, create and work tasks; creating, archiving and deleting projects, and deleting anyone's tasks, is for owners and admins.

## Use the pieces

```ts
import { dueBucket, nextDue, taskInputSchema, today } from "@templates/tasks/definitions" // browser-safe
import { createTask, listTasks, setTaskStatus } from "@templates/tasks" // server

const ctx = { orgId, user } // from requirePermission({ task: ["write"] })
const t = await createTask(ctx, {
  title: "Weekly cash count",
  dueOn: "2026-11-12",
  recurrence: "weekly",
})
const { next } = await setTaskStatus(ctx, t.id, "done") // next.dueOn === "2026-11-19"
const mine = await listTasks({ orgId, userId: user.id }) // open tasks assigned to me
```

Service functions throw `TaskError` with a status and, for invalid input, `fieldErrors` keyed by field. See `app/actions/tasks.ts` in the starter.

## Make it yours

- **Statuses**: add one (e.g. "review") to `TASK_STATUSES` in `src/definitions.ts` and the schema (a test keeps them in sync), then generate a migration; the board gets a column automatically.
- **Repeat rules**: extend `TASK_RECURRENCES` and `nextDue()`.
- **Link tasks to records**: add a nullable column (e.g. `customer_id` with a composite FK like the CRM's) and a picker in `TaskEditor`.
- **Due reminders**: call `listTasks({ orgId }, { assignee: "all" })` from a daily job and `notify()` the overdue ones.

## Setup

`pnpm --filter @templates/db db:migrate` creates `project`, `task`, `task_checklist_item` and `task_comment`. It needs the Auth, Audit log and Notifications modules.
