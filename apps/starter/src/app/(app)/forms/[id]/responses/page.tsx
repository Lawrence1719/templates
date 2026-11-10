import { requirePermission } from "@templates/auth/guards"
import { displayAnswer, FormError, listSubmissions } from "@templates/forms"
import { Card, PageHeader } from "@templates/ui/card"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

export const metadata: Metadata = { title: "Responses" }

const fmt = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })

export default async function ResponsesPage({ params }: PageProps<"/forms/[id]/responses">) {
  const ctx = await requirePermission({ response: ["read"] }).catch(() => redirect("/dashboard"))
  const { id } = await params
  const { form, fields, rows } = await listSubmissions(ctx, id).catch((e) => {
    if (e instanceof FormError) notFound()
    throw e
  })

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <Link href={`/forms/${id}`} className="text-sm text-muted-foreground hover:text-foreground">
        ← {form.title}
      </Link>
      <PageHeader
        title="Responses"
        description={`${rows.length} ${rows.length === 1 ? "response" : "responses"} to ${form.title}.`}
        actions={
          rows.length > 0 && (
            <a
              href={`/forms/${id}/responses/export`}
              className="inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium hover:bg-accent"
            >
              Export CSV
            </a>
          )
        }
      />
      <Card className="overflow-hidden p-0">
        {rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            No responses yet.
            {form.status === "draft" && " Publish the form and share its link to start collecting."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">Submitted</th>
                  {fields.map((f) => (
                    <th key={f.id} className="max-w-60 px-4 py-2.5 font-medium">
                      {f.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                      {fmt.format(r.createdAt)}
                      {r.submitterEmail && (
                        <span className="block text-xs">{r.submitterEmail}</span>
                      )}
                    </td>
                    {fields.map((f) => (
                      <td key={f.id} className="max-w-60 px-4 py-3 break-words whitespace-pre-line">
                        {displayAnswer(r.data[f.id])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
