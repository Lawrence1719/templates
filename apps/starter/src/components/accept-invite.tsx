"use client"

import { organization } from "@templates/auth/client"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button, Card, ErrorText } from "./ui"

export function AcceptInvite({ id }: { id: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function respond(accept: boolean) {
    setPending(true)
    const { data, error } = accept
      ? await organization.acceptInvitation({ invitationId: id })
      : await organization.rejectInvitation({ invitationId: id })
    setPending(false)
    if (error) return setError(error.message ?? "This invitation is no longer valid")
    if (accept && data?.member)
      await organization.setActive({ organizationId: data.member.organizationId })
    router.replace(accept ? "/dashboard" : "/")
    router.refresh()
  }

  return (
    <Card className="w-full max-w-sm text-center">
      <h1 className="text-xl font-semibold">You've been invited</h1>
      <p className="mt-2 text-sm text-neutral-500">Join the organization to get started.</p>
      <div className="mt-6 flex justify-center gap-3">
        <Button variant="ghost" disabled={pending} onClick={() => respond(false)}>
          Decline
        </Button>
        <Button disabled={pending} onClick={() => respond(true)}>
          Accept
        </Button>
      </div>
      <div className="mt-4">
        <ErrorText>{error}</ErrorText>
      </div>
    </Card>
  )
}
