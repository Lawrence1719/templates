"use client"

import { signIn, signUp } from "@templates/auth/client"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"

import { Button, Card, ErrorText, Field } from "./ui"

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter()
  const next = useSearchParams().get("next") ?? "/dashboard"
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const form = new FormData(e.currentTarget)
    const email = String(form.get("email"))
    const password = String(form.get("password"))
    const { error } =
      mode === "sign-in"
        ? await signIn.email({ email, password })
        : await signUp.email({ email, password, name: String(form.get("name")) })
    setPending(false)
    if (error) return setError(error.message ?? "Something went wrong")
    // Only allow internal redirects.
    router.replace(next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard")
    router.refresh()
  }

  const isSignUp = mode === "sign-up"
  return (
    <Card className="w-full max-w-sm">
      <h1 className="text-xl font-semibold">{isSignUp ? "Create an account" : "Sign in"}</h1>
      <form onSubmit={onSubmit} className="mt-6 grid gap-4">
        {isSignUp && <Field label="Name" name="name" required autoComplete="name" />}
        <Field label="Email" name="email" type="email" required autoComplete="email" />
        <Field
          label="Password"
          name="password"
          type="password"
          required
          minLength={10}
          autoComplete={isSignUp ? "new-password" : "current-password"}
        />
        <ErrorText>{error}</ErrorText>
        <Button disabled={pending}>
          {pending ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}
        </Button>
      </form>
      <p className="mt-4 text-sm text-neutral-500">
        {isSignUp ? "Already have an account? " : "No account yet? "}
        <Link
          className="underline"
          href={`${isSignUp ? "/sign-in" : "/sign-up"}${next !== "/dashboard" ? `?next=${encodeURIComponent(next)}` : ""}`}
        >
          {isSignUp ? "Sign in" : "Sign up"}
        </Link>
      </p>
    </Card>
  )
}
