import { getSession } from "@templates/auth/guards"
import { getFillableForm } from "@templates/forms"
import type { Metadata } from "next"
import Link from "next/link"

import { PublicForm } from "@/components/public-form"

type Props = PageProps<"/f/[slug]">

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const r = await getFillableForm((await params).slug, null)
  // Public forms only: members-only titles aren't exposed to link previews.
  const title = r.state !== "missing" && r.form.visibility === "public" ? r.form.title : "Form"
  return { title, robots: { index: false, follow: false } }
}

export default async function FillFormPage({ params }: Props) {
  const { slug } = await params
  const session = await getSession()
  const r = await getFillableForm(slug, session?.user.id ?? null)

  return (
    <main className="mx-auto min-h-dvh max-w-xl px-4 py-12 sm:py-16">
      {r.state === "missing" ? (
        <Message title="Form not found" body="This link may be wrong, or the form was removed." />
      ) : r.state === "sign-in" ? (
        <Message
          title={r.form.title}
          body="This form is for members of the organization. Sign in to continue."
          action={
            <Link href={`/sign-in?next=${encodeURIComponent(`/f/${slug}`)}`} className="underline">
              Sign in
            </Link>
          }
        />
      ) : r.state === "closed" ? (
        <Message title={r.form.title} body="This form is no longer accepting responses." />
      ) : (
        <div className="grid gap-8">
          <header>
            <h1 className="text-2xl font-semibold tracking-tight">{r.form.title}</h1>
            {r.form.description && (
              <p className="mt-2 whitespace-pre-line text-muted-foreground">{r.form.description}</p>
            )}
          </header>
          <PublicForm slug={slug} fields={r.fields} />
        </div>
      )}
    </main>
  )
}

function Message({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: React.ReactNode
}) {
  return (
    <div className="grid gap-2 rounded-xl border p-8 text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{body}</p>
      {action && <p className="mt-2 text-sm">{action}</p>}
    </div>
  )
}
