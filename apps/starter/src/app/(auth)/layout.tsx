import { getSession } from "@templates/auth/guards"
import { redirect } from "next/navigation"

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getSession()) redirect("/dashboard")
  return <main className="grid min-h-dvh place-items-center px-4">{children}</main>
}
