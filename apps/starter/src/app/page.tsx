import { getSession } from "@templates/auth/guards"
import { redirect } from "next/navigation"

export default async function Home() {
  redirect((await getSession()) ? "/dashboard" : "/sign-in")
}
