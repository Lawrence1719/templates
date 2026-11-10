"use client"

import { authClient, organization } from "@templates/auth/client"
import { Button } from "@templates/ui/button"
import { ErrorText, Field } from "@templates/ui/form"
import { useRouter } from "next/navigation"
import { useState } from "react"

function useSave() {
  const router = useRouter()
  const [state, setState] = useState<{ pending?: boolean; error?: string; saved?: boolean }>({})
  async function save(fn: () => Promise<{ error: { message?: string } | null }>) {
    setState({ pending: true })
    const { error } = await fn()
    setState(error ? { error: error.message ?? "Could not save" } : { saved: true })
    if (!error) router.refresh()
  }
  return { state, save }
}

export function ProfileForm({ name, email }: { name: string; email: string }) {
  const { state, save } = useSave()
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        const name = String(new FormData(e.currentTarget).get("name")).trim()
        save(() => authClient.updateUser({ name }))
      }}
    >
      <Field label="Name" name="name" defaultValue={name} required maxLength={80} />
      <Field
        label="Email"
        defaultValue={email}
        disabled
        hint="Email changes arrive in a later version."
      />
      <ErrorText>{state.error}</ErrorText>
      <div className="flex items-center gap-3">
        <Button disabled={state.pending}>{state.pending ? "Saving…" : "Save"}</Button>
        {state.saved && <span className="text-sm text-success">Saved</span>}
      </div>
    </form>
  )
}

export function OrgNameForm({ name, disabled }: { name: string; disabled: boolean }) {
  const { state, save } = useSave()
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        const name = String(new FormData(e.currentTarget).get("name")).trim()
        save(() => organization.update({ data: { name } }))
      }}
    >
      <Field
        label="Organization name"
        name="name"
        defaultValue={name}
        required
        maxLength={80}
        disabled={disabled}
        hint={disabled ? "Only owners and admins can rename the organization." : undefined}
      />
      <ErrorText>{state.error}</ErrorText>
      {!disabled && (
        <div className="flex items-center gap-3">
          <Button disabled={state.pending}>{state.pending ? "Saving…" : "Save"}</Button>
          {state.saved && <span className="text-sm text-success">Saved</span>}
        </div>
      )}
    </form>
  )
}
