import { can, requirePermission } from "@templates/auth/guards"
import { listProjects, listTasks, taskFilterSchema, taskMembers } from "@templates/tasks"
import { PageHeader } from "@templates/ui/card"
import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { QuickAdd, TaskFilters, TaskList } from "@/components/tasks"

export const metadata: Metadata = { title: "Tasks" }

export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  const { orgId, user } = await requirePermission({ task: ["read"] }).catch(() =>
    redirect("/dashboard"),
  )
  const raw = Object.fromEntries(
    Object.entries(await searchParams).map(([k, v]) => [
      k,
      Array.isArray(v) ? v[0] : v || undefined,
    ]),
  )
  const filter = taskFilterSchema.parse(raw)
  const [tasks, members, projects, canWrite] = await Promise.all([
    listTasks({ orgId, userId: user.id }, filter),
    taskMembers({ orgId }),
    listProjects({ orgId }),
    can({ task: ["write"] }),
  ])
  const assignee = filter.assignee ?? "me"
  const mine = assignee === "me"
  const open = (filter.status ?? "open") !== "done"
  const filtered = !!(filter.q || filter.priority || filter.project || filter.status)

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader
        title={mine ? "My tasks" : "Tasks"}
        description="What needs doing, who's on it and when it's due."
      />
      {canWrite && (
        <QuickAdd
          // Adding from "My tasks" assigns it to you; from a teammate's view, to them.
          assigneeId={
            mine ? user.id : assignee !== "all" && assignee !== "none" ? assignee : undefined
          }
          projectId={filter.project}
        />
      )}
      <TaskFilters
        members={members.filter((m) => m.id !== user.id)}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
      />
      <TaskList
        tasks={tasks}
        grouped={open}
        showAssignee={!mine}
        empty={
          filtered
            ? "No tasks match these filters."
            : mine
              ? "Nothing on your plate. Add a task above."
              : "No open tasks."
        }
      />
      {tasks.length === 500 && (
        <p className="text-center text-xs text-muted-foreground">
          Showing the first 500. Narrow the filters to see the rest.
        </p>
      )}
    </div>
  )
}
