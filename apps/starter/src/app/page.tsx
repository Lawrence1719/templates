export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-4 px-6">
      <p className="font-mono text-sm text-neutral-500">templates / starter</p>
      <h1 className="text-3xl font-semibold tracking-tight">Business system starter</h1>
      <p className="text-neutral-600 dark:text-neutral-400">
        Next.js, Postgres and Drizzle. Modules are added one at a time — next up: auth, roles and
        teams.
      </p>
    </main>
  )
}
