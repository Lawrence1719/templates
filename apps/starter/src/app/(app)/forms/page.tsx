import { requirePermission } from "@templates/auth/guards"
import { listForms } from "@templates/forms"
import { Button } from "@templates/ui/button"
import { Card, PageHeader } from "@templates/ui/card"
import { cn } from "@templates/ui/cn"
import { Plus } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { newFormAction } from "@/app/actions/forms"
import { timeAgo } from "@/components/time-ago"

export const metadata: Metadata = { title: "Forms" }

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-xs capitalize",
        status === "published" && "border-success/40 text-success",
        status === "closed" && "text-muted-foreground",
      )}
    >
      {status}
    </span>
  )
}

export default async function FormsPage() {
  const ctx = await requirePermission({ form: ["manage"] }).catch(() => redirect("/dashboard"))
  const forms = await listForms(ctx)
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader
        title="Forms"
        description="Intake forms, surveys and requests. Share a link and collect responses."
        actions={
          <form action={newFormAction}>
            <Button>
              <Plus /> New form
            </Button>
          </form>
        }
      />
      <Card className="p-0">
        {forms.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            No forms yet. Create your first one.
          </p>
        ) : (
          <ul className="divide-y">
            {forms.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <Link href={`/forms/${f.id}`} className="font-medium hover:underline">
                    {f.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {f.visibility === "public" ? "Anyone with the link" : "Members only"} · edited{" "}
                    {timeAgo(f.updatedAt)}
                  </p>
                </div>
                <StatusBadge status={f.status} />
                <Link
                  href={`/forms/${f.id}/responses`}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  {f.responses} {f.responses === 1 ? "response" : "responses"}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
