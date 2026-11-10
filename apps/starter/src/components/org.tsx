"use client"

import { organization } from "@templates/auth/client"
import { Button } from "@templates/ui/button"
import { ErrorText, Field } from "@templates/ui/form"
import { useRouter } from "next/navigation"
import { useState } from "react"

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")

export function CreateOrgForm() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    const name = String(new FormData(e.currentTarget).get("name"))
    const slug = `${slugify(name)}-${crypto.randomUUID().slice(0, 6)}`
    const { data, error } = await organization.create({ name, slug })
    if (error || !data) {
      setPending(false)
      return setError(error?.message ?? "Could not create organization")
    }
    await organization.setActive({ organizationId: data.id })
    router.replace("/dashboard")
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 grid gap-4">
      <Field label="Organization name" name="name" required maxLength={80} />
      <ErrorText>{error}</ErrorText>
      <Button disabled={pending}>{pending ? "Creating…" : "Create organization"}</Button>
    </form>
  )
}

export function InviteForm() {
  const router = useRouter()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formEl = e.currentTarget
    const form = new FormData(formEl)
    setPending(true)
    const { error } = await organization.inviteMember({
      email: String(form.get("email")),
      role: form.get("role") as "admin" | "member",
    })
    setPending(false)
    if (error) return setMsg({ ok: false, text: error.message ?? "Could not send invite" })
    formEl.reset()
    setMsg({ ok: true, text: "Invitation sent." })
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
      <Field label="Invite by email" name="email" type="email" required />
      <select
        name="role"
        aria-label="Role"
        className="h-9 rounded-md border bg-transparent px-2 text-sm"
      >
        <option value="member">Member</option>
        <option value="admin">Admin</option>
      </select>
      <Button disabled={pending}>{pending ? "Sending…" : "Invite"}</Button>
      {msg && (
        <p className={`text-sm sm:col-span-3 ${msg.ok ? "text-success" : "text-danger"}`}>
          {msg.text}
        </p>
      )}
    </form>
  )
}

export function MemberActions({
  memberId,
  role,
  canManage,
}: {
  memberId: string
  role: string
  canManage: boolean
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  if (!canManage || role === "owner") return <span className="text-sm capitalize">{role}</span>
  return (
    <div className="flex items-center gap-2">
      <select
        aria-label="Change role"
        defaultValue={role}
        className="h-8 rounded-md border bg-transparent px-2 text-sm"
        onChange={async (e) => {
          const { error } = await organization.updateMemberRole({
            memberId,
            role: e.target.value as "admin" | "member",
          })
          setError(error?.message ?? null)
          router.refresh()
        }}
      >
        <option value="member">Member</option>
        <option value="admin">Admin</option>
      </select>
      <Button
        variant="danger"
        className="h-8 px-2"
        onClick={async () => {
          if (!confirm("Remove this member?")) return
          const { error } = await organization.removeMember({ memberIdOrEmail: memberId })
          setError(error?.message ?? null)
          router.refresh()
        }}
      >
        Remove
      </Button>
      <ErrorText>{error}</ErrorText>
    </div>
  )
}

export function CancelInvite({ id }: { id: string }) {
  const router = useRouter()
  return (
    <Button
      variant="danger"
      className="h-8 px-2"
      onClick={async () => {
        await organization.cancelInvitation({ invitationId: id })
        router.refresh()
      }}
    >
      Cancel
    </Button>
  )
}
