import { can, requirePermission } from "@templates/auth/guards"
import { listProjects } from "@templates/tasks"
import { PageHeader } from "@templates/ui/card"
import { cn } from "@templates/ui/cn"
import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { NewProjectForm } from "@/components/tasks"

export const metadata: Metadata = { title: "Projects" }

export default async function ProjectsPage({ searchParams }: PageProps<"/projects">) {
  const { orgId } = await requirePermission({ project: ["read"] }).catch(() =>
    redirect("/dashboard"),
  )
  const archived = (await searchParams).show === "archived"
  const [all, canManage] = await Promise.all([
    listProjects({ orgId }, { includeArchived: archived }),
    can({ project: ["manage"] }),
  ])
  const projects = archived ? all.filter((p) => p.status === "archived") : all

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader
        title="Projects"
        description="Group related tasks and follow their progress on a board."
        actions={canManage && <NewProjectForm />}
      />
      <div className="flex gap-4 text-sm">
        <Link
          href="/projects"
          aria-current={!archived ? "page" : undefined}
          className={cn(!archived ? "font-medium" : "text-muted-foreground hover:text-foreground")}
        >
          Active
        </Link>
        <Link
          href="/projects?show=archived"
          aria-current={archived ? "page" : undefined}
          className={cn(archived ? "font-medium" : "text-muted-foreground hover:text-foreground")}
        >
          Archived
        </Link>
      </div>
      {projects.length === 0 ? (
        <p className="rounded-xl border p-10 text-center text-sm text-muted-foreground">
          {archived ? "No archived projects." : "No projects yet."}
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => {
            const pct = p.total ? Math.round((p.done / p.total) * 100) : 0
            return (
              <li key={p.id}>
                <Link
                  href={`/projects/${p.id}`}
                  className="grid h-full gap-3 rounded-xl border p-5 transition-colors hover:bg-muted/50"
                >
                  <div>
                    <h2 className="font-semibold">{p.name}</h2>
                    {p.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {p.description}
                      </p>
                    )}
                  </div>
                  <div className="mt-auto grid gap-1.5">
                    <div
                      className="h-1.5 overflow-hidden rounded-full bg-muted"
                      role="progressbar"
                      aria-label={`${p.name} progress`}
                      aria-valuenow={pct}
                      aria-valuemax={100}
                    >
                      <div className="h-full bg-success" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="flex justify-between text-xs text-muted-foreground">
                      <span>
                        {p.done} of {p.total} done
                      </span>
                      {p.overdue > 0 && <span className="text-danger">{p.overdue} overdue</span>}
                    </p>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
