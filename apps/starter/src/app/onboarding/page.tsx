import { requireUser } from "@templates/auth/guards"

import { CreateOrgForm } from "@/components/org"

export default async function OnboardingPage() {
  const { user } = await requireUser()
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <p className="text-sm text-muted-foreground">Welcome, {user.name}</p>
        <h1 className="mt-1 text-xl font-semibold">Create your organization</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Everything you create belongs to an organization. You can invite your team next.
        </p>
        <CreateOrgForm />
      </div>
    </main>
  )
}
