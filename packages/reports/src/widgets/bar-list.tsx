import type { BreakdownRow } from "../types"

/**
 * Ranked horizontal bars with the label and value written out,
 * so it reads without color or hover (and works as its own table).
 */
export function BarList({
  title,
  rows,
  empty = "Nothing yet.",
}: {
  title: string
  rows: BreakdownRow[]
  empty?: string
}) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <section className="rounded-xl border p-5">
      <h2 className="text-sm font-medium">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-4 grid gap-2">
          {rows.map((r) => (
            <li
              key={r.label}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-sm"
            >
              <div className="relative h-7 min-w-0">
                <div
                  className="absolute inset-y-0 left-0 rounded-r-[4px] bg-chart-1/15 dark:bg-chart-1/35"
                  style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }}
                  aria-hidden
                />
                <span className="relative block truncate px-2 leading-7" title={r.label}>
                  {r.label}
                </span>
              </div>
              <span className="tabular-nums text-muted-foreground">
                {r.value.toLocaleString("en")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
