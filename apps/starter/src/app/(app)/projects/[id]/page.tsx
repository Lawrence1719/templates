import { can, requirePermission } from "@templates/auth/guards"
import { projectTasks, STATUS_LABELS, TASK_STATUSES, TaskError } from "@templates/tasks"
import { cn } from "@templates/ui/cn"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { DueLabel, PriorityBadge, ProjectActions, QuickAdd, StatusSelect } from "@/components/tasks"

export const metadata: Metadata = { title: "Project" }

export default async function ProjectPage({ params }: PageProps<"/projects/[id]">) {
  const { id } = await params
  const ctx = await requirePermission({ project: ["read"] }).catch(() => redirect("/dashboard"))
  const { project: p, tasks } = await projectTasks(ctx, id).catch((e) => {
    if (e instanceof TaskError) notFound()
    throw e
  })
  const [canManage, canWrite] = await Promise.all([
    can({ project: ["manage"] }),
    can({ task: ["write"] }),
  ])
  const archived = p.status === "archived"
  const done = tasks.filter((t) => t.status === "done").length

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <Link href="/projects" className="text-sm text-muted-foreground hover:text-foreground">
            ← Projects
          </Link>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
            {p.name}
            {archived && (
              <span className="rounded-full border px-2 py-0.5 text-xs font-normal text-muted-foreground">
                Archived
              </span>
            )}
          </h1>
          {p.description && <p className="text-sm text-muted-foreground">{p.description}</p>}
          <p className="text-xs text-muted-foreground">
            {done} of {tasks.length} tasks done
          </p>
        </div>
        {canManage && <ProjectActions id={p.id} name={p.name} archived={archived} />}
      </div>

      {canWrite && !archived && (
        <QuickAdd projectId={p.id} placeholder={`Add a task to ${p.name}…`} />
      )}

      <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        <div className="grid min-w-[42rem] grid-cols-3 gap-3">
          {TASK_STATUSES.map((status) => {
            const col = tasks.filter((t) => t.status === status)
            return (
              <section
                key={status}
                aria-label={STATUS_LABELS[status]}
                className="grid content-start gap-2"
              >
                <h2 className="px-1 text-sm font-semibold">
                  {STATUS_LABELS[status]}{" "}
                  <span className="font-normal text-muted-foreground">{col.length}</span>
                </h2>
                <ul className="grid min-h-24 gap-2 rounded-xl bg-muted/60 p-2">
                  {col.map((t) => (
                    <li key={t.id} className="grid gap-2 rounded-lg border bg-background p-3">
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          href={`/tasks/${t.id}`}
                          className={cn(
                            "text-sm font-medium leading-snug hover:underline",
                            status === "done" && "text-muted-foreground line-through",
                          )}
                        >
                          {t.title}
                        </Link>
                        <PriorityBadge priority={t.priority} />
                      </div>
                      <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                        <span>{t.assigneeName ?? "Unassigned"}</span>
                        {t.dueOn && (
                          <>
                            <span aria-hidden>·</span>
                            <DueLabel dueOn={t.dueOn} done={status === "done"} />
                          </>
                        )}
                      </p>
                      {canWrite && <StatusSelect id={t.id} status={t.status} title={t.title} />}
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
