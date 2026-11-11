/** Formatting for HR pages, in the org's time zone. Server-safe. */
const dayFmt = new Intl.DateTimeFormat("en", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
})
const longDayFmt = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" })

export const formatHrDay = (day: string) => dayFmt.format(new Date(`${day}T00:00:00Z`))
export const formatLongDay = (day: string) => longDayFmt.format(new Date(`${day}T00:00:00Z`))

export function formatRange(start: string, end: string, halfDay = false) {
  if (start === end) return `${formatLongDay(start)}${halfDay ? " (half day)" : ""}`
  return `${formatHrDay(start)} – ${formatLongDay(end)}`
}

/** "09:05" in a zone, and the YYYY-MM-DD it falls on. */
export function clockParts(d: Date, timeZone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  ) as Record<string, string>
  return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }
}

/** What a time-entry row and its edit form need. */
export function entryView(
  e: {
    id: string
    clockIn: Date
    clockOut: Date | null
    note: string | null
    minutes: number
    editedAt: Date | null
    source: string
  },
  timeZone: string,
) {
  const a = clockParts(e.clockIn, timeZone)
  const b = e.clockOut ? clockParts(e.clockOut, timeZone) : null
  return {
    label: `${formatHrDay(a.day)}, ${a.time}–${b ? `${b.time}${b.day !== a.day ? " (+1)" : ""}` : "now"}`,
    entry: {
      id: e.id,
      day: a.day,
      start: a.time,
      end: b?.time ?? "",
      overnight: !!b && b.day !== a.day,
      note: e.note ?? "",
      minutes: e.minutes,
      edited: !!e.editedAt,
      manual: e.source === "manual",
    },
  }
}
