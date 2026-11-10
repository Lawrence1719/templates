import { getSession } from "@templates/auth/guards"
import { redirect } from "next/navigation"

import { AcceptInvite } from "@/components/accept-invite"

export default async function AcceptInvitePage({ params }: PageProps<"/accept-invite/[id]">) {
  const { id } = await params
  const session = await getSession()
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(`/accept-invite/${id}`)}`)
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <AcceptInvite id={id} />
    </main>
  )
}
