"use client"

import type { Field } from "@templates/forms/definitions"
import { CheckCircle2 } from "lucide-react"
import { useState } from "react"

import { submitFormAction } from "@/app/actions/forms"

import { FormRenderer } from "./form-renderer"

export function PublicForm({ slug, fields }: { slug: string; fields: Field[] }) {
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (done !== null)
    return (
      <div
        role="status"
        className="grid justify-items-center gap-3 rounded-xl border p-10 text-center"
      >
        <CheckCircle2 className="size-8 text-success" />
        <p className="font-medium">{done || "Thanks — your response was sent."}</p>
      </div>
    )

  return (
    <div className="grid gap-4">
      <FormRenderer
        fields={fields}
        onSubmit={async (answers, honeypot) => {
          setError(null)
          const r = await submitFormAction(slug, answers, honeypot)
          if (r.ok) {
            setDone("confirmation" in r ? (r.confirmation ?? "") : "")
            return undefined
          }
          setError(r.error)
          return r.fieldErrors
        }}
      />
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
