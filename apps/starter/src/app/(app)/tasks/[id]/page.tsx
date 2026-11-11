import { can, requirePermission } from "@templates/auth/guards"
import { getTask, listProjects, TaskError, taskMembers } from "@templates/tasks"
import { Card } from "@templates/ui/card"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import {
  Checklist,
  CommentBox,
  CompleteToggle,
  DeleteCommentButton,
  DeleteTaskButton,
  TaskEditor,
} from "@/components/tasks"
import { timeAgo } from "@/components/time-ago"

export const metadata: Metadata = { title: "Task" }

const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })

export default async function TaskPage({ params }: PageProps<"/tasks/[id]">) {
  const { id } = await params
  const ctx = await requirePermission({ task: ["read"] }).catch(() => redirect("/dashboard"))
  const data = await getTask(ctx, id).catch((e) => {
    if (e instanceof TaskError) notFound()
    throw e
  })
  const { task: t, project, checklist, comments } = data
  const [canWrite, canDeleteAny, members, projects] = await Promise.all([
    can({ task: ["write"] }),
    can({ task: ["delete"] }),
    taskMembers(ctx),
    listProjects(ctx),
  ])
  // Keep the current project selectable even if it was archived after the task was filed.
  const projectOptions = projects.map((p) => ({ id: p.id, name: p.name }))
  if (project && !projectOptions.some((p) => p.id === project.id))
    projectOptions.push({ id: project.id, name: `${project.name} (archived)` })
  const canDelete = canWrite && (canDeleteAny || t.createdBy === ctx.user.id)

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <div className="grid gap-2">
        <Link
          href={project ? `/projects/${project.id}` : "/tasks"}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← {project ? project.name : "Tasks"}
        </Link>
        <div className="flex items-start gap-3">
          {canWrite && <CompleteToggle id={t.id} status={t.status} title={t.title} />}
          <h1 className="text-2xl font-semibold tracking-tight break-words">{t.title}</h1>
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid gap-4">
          <Card className="p-5">
            <TaskEditor
              key={t.updatedAt.toISOString()}
              id={t.id}
              canEdit={canWrite}
              members={members}
              projects={projectOptions}
              initial={{
                title: t.title,
                description: t.description ?? "",
                status: t.status,
                priority: t.priority,
                assigneeId: t.assigneeId ?? "",
                projectId: t.projectId ?? "",
                dueOn: t.dueOn ?? "",
                recurrence: t.recurrence,
                recurrenceInterval: String(t.recurrenceInterval),
              }}
            />
          </Card>

          <Card className="grid gap-4 p-5">
            <h2 className="text-sm font-semibold">Comments</h2>
            {comments.length === 0 && (
              <p className="text-sm text-muted-foreground">No comments yet.</p>
            )}
            <ol className="grid gap-4">
              {comments.map((c) => (
                <li key={c.id} className="flex gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {c.authorName ?? "Former member"}
                      </span>{" "}
                      ·{" "}
                      <time dateTime={c.createdAt.toISOString()} title={when.format(c.createdAt)}>
                        {timeAgo(c.createdAt)}
                      </time>
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{c.body}</p>
                  </div>
                  {(canDeleteAny || c.authorId === ctx.user.id) && (
                    <DeleteCommentButton id={c.id} />
                  )}
                </li>
              ))}
            </ol>
            <CommentBox taskId={t.id} />
          </Card>
        </div>

        <div className="grid gap-4">
          <Card className="grid gap-3 p-5">
            <h2 className="text-sm font-semibold">Checklist</h2>
            <Checklist taskId={t.id} items={checklist} canEdit={canWrite} />
          </Card>
          <Card className="grid gap-2 p-5 text-sm">
            <p className="text-muted-foreground">
              Created by {data.creatorName ?? "a former member"} {timeAgo(t.createdAt)}
            </p>
            {t.completedAt && (
              <p className="text-muted-foreground">Completed {when.format(t.completedAt)}</p>
            )}
            {t.nextTaskId && (
              <Link href={`/tasks/${t.nextTaskId}`} className="underline">
                Next occurrence →
              </Link>
            )}
            {canDelete && (
              <div className="pt-2">
                <DeleteTaskButton id={t.id} title={t.title} />
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
