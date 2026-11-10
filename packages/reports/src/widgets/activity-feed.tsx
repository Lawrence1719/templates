const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" })

function ago(date: Date, now = Date.now()) {
  const s = Math.round((date.getTime() - now) / 1000)
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ]
  for (const [unit, secs] of units)
    if (Math.abs(s) >= secs) return rtf.format(Math.round(s / secs), unit)
  return "just now"
}

export function ActivityFeed({
  items,
  moreHref,
}: {
  items: { id: string; summary: string; actorName: string | null; createdAt: Date }[]
  moreHref?: string
}) {
  return (
    <section className="rounded-xl border p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Recent activity</h2>
        {moreHref && (
          <a href={moreHref} className="text-xs text-muted-foreground hover:text-foreground">
            View all
          </a>
        )}
      </div>
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No activity yet.</p>
      ) : (
        <ol className="mt-4 grid gap-3">
          {items.map((i) => (
            <li key={i.id} className="min-w-0 text-sm">
              <p className="line-clamp-2">
                <span className="font-medium">{i.actorName ?? "System"}</span>{" "}
                <span className="text-muted-foreground">{i.summary}</span>
              </p>
              <time dateTime={i.createdAt.toISOString()} className="text-xs text-muted-foreground">
                {ago(i.createdAt)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
