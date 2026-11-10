import { requirePermission } from "@templates/auth/guards"
import { FormError, fieldsOf, getForm } from "@templates/forms"
import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"

import { FormBuilder } from "@/components/form-builder"

export const metadata: Metadata = { title: "Edit form" }

export default async function FormBuilderPage({ params }: PageProps<"/forms/[id]">) {
  const ctx = await requirePermission({ form: ["manage"] }).catch(() => redirect("/dashboard"))
  const f = await getForm(ctx, (await params).id).catch((e) => {
    if (e instanceof FormError) notFound()
    throw e
  })
  const base = process.env.BETTER_AUTH_URL ?? "http://localhost:3000"
  return (
    <FormBuilder
      id={f.id}
      status={f.status}
      shareUrl={`${base}/f/${f.slug}`}
      initial={{
        title: f.title,
        description: f.description ?? "",
        visibility: f.visibility,
        confirmation: f.confirmation ?? "",
        fields: fieldsOf(f),
      }}
    />
  )
}
