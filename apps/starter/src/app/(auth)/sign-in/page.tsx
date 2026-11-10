import { Suspense } from "react"

import { AuthForm } from "@/components/auth-form"

export default function Page() {
  return (
    <Suspense>
      <AuthForm mode="sign-in" />
    </Suspense>
  )
}
