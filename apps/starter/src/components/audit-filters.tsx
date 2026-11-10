"use client"

import { Button } from "@templates/ui/button"
import { Select } from "@templates/ui/form"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

const input =
  "h-9 rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"

/** Filters live in the URL so a filtered view can be bookmarked or shared. */
export function AuditFilters({
  actions,
  actors,
}: {
  actions: string[]
  actors: { id: string; email: string }[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const active = ["q", "action", "actor", "from", "to"].some((k) => params.get(k))

  return (
    <form
      className="flex flex-wrap gap-2 [&>*]:min-w-0"
      onSubmit={(e) => {
        e.preventDefault()
        const p = new URLSearchParams()
        for (const [k, v] of new FormData(e.currentTarget)) if (v) p.set(k, String(v))
        router.push(`${pathname}${p.size ? `?${p}` : ""}`)
      }}
    >
      <input
        name="q"
        type="search"
        aria-label="Search"
        placeholder="Search summary or email…"
        defaultValue={params.get("q") ?? ""}
        className={`${input} basis-full sm:basis-56 sm:grow`}
      />
      <Select
        name="action"
        aria-label="Action"
        className="flex-1 sm:flex-none"
        defaultValue={params.get("action") ?? ""}
      >
        <option value="">All actions</option>
        {actions.map((a) => (
          <option key={a}>{a}</option>
        ))}
      </Select>
      <Select
        name="actor"
        aria-label="Person"
        className="flex-1 sm:flex-none"
        defaultValue={params.get("actor") ?? ""}
      >
        <option value="">Everyone</option>
        {actors.map((a) => (
          <option key={a.id} value={a.id}>
            {a.email}
          </option>
        ))}
      </Select>
      <input
        name="from"
        type="date"
        aria-label="From"
        defaultValue={params.get("from") ?? ""}
        className={input}
      />
      <input
        name="to"
        type="date"
        aria-label="To"
        defaultValue={params.get("to") ?? ""}
        className={input}
      />
      <div className="flex gap-2">
        <Button>Filter</Button>
        {active && (
          <Button type="button" variant="quiet" onClick={() => router.push(pathname)}>
            Clear
          </Button>
        )}
      </div>
    </form>
  )
}
