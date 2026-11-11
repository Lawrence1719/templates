/**
 * Time-zone math without a date library. Opening hours are wall-clock times in
 * the business's zone; bookings are stored as UTC instants. These helpers turn
 * one into the other, including across daylight-saving changes.
 * Safe to import in the browser.
 */

const fmtCache = new Map<string, Intl.DateTimeFormat>()
function partsFormatter(timeZone: string) {
  let f = fmtCache.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    })
    fmtCache.set(timeZone, f)
  }
  return f
}

export function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz })
    return true
  } catch {
    return false
  }
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

/** The wall-clock date, minutes past midnight and weekday of an instant in a zone. */
export function localParts(date: Date, timeZone: string) {
  const p = Object.fromEntries(
    partsFormatter(timeZone)
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  )
  return {
    day: `${p.year}-${p.month}-${p.day}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
    weekday: WEEKDAYS.indexOf(p.weekday ?? ""),
  }
}

/** How far the zone is ahead of UTC at an instant, in minutes. */
export function offsetMinutes(date: Date, timeZone: string) {
  const p = Object.fromEntries(
    partsFormatter(timeZone)
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  )
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!)
  return Math.round((asUtc - date.getTime()) / 60_000)
}

/**
 * The instant when it's `minutes` past midnight on `day` in `timeZone`.
 * Returns null for wall times that don't exist (skipped by a spring-forward change).
 */
export function zonedToUtc(day: string, minutes: number, timeZone: string): Date | null {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number]
  const guess = Date.UTC(y, m - 1, d, 0, minutes)
  let t = guess - offsetMinutes(new Date(guess), timeZone) * 60_000
  const second = guess - offsetMinutes(new Date(t), timeZone) * 60_000
  if (second !== t) t = second
  const back = localParts(new Date(t), timeZone)
  const wantDay = new Date(guess).toISOString().slice(0, 10)
  const wantMinutes = ((minutes % 1440) + 1440) % 1440
  return back.day === wantDay && back.minutes === wantMinutes ? new Date(t) : null
}

export const today = (timeZone: string, now = new Date()) => localParts(now, timeZone).day

export function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** 0 = Sunday. A calendar date's weekday doesn't depend on the zone. */
export const weekdayOf = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay()

export const isDay = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s

/** "09:30" → 570. */
export function parseClock(s: string): number | null {
  const m = /^([01]?\d|2[0-4]):([0-5]\d)$/.exec(s.trim())
  if (!m) return null
  const v = Number(m[1]) * 60 + Number(m[2])
  return v <= 1440 ? v : null
}
export const formatClock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`

export const formatTime = (date: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en", { timeZone, hour: "numeric", minute: "2-digit" }).format(date)
export const formatDate = (date: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)
export const formatDayLabel = (day: string) =>
  new Intl.DateTimeFormat("en", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${day}T00:00:00Z`))

export type Interval = { startMinute: number; endMinute: number }
export type Busy = { start: Date; end: Date }

/**
 * Start times on `day` that fit a service of `durationMinutes` (+ buffer) into
 * the opening `hours`, avoid every `busy` range, and respect notice and horizon.
 */
export function computeSlots(opts: {
  day: string
  timeZone: string
  hours: Interval[]
  durationMinutes: number
  bufferMinutes: number
  stepMinutes: number
  busy: Busy[]
  now: Date
  minNoticeMinutes: number
  maxDaysAhead: number
}): Date[] {
  const todayStr = today(opts.timeZone, opts.now)
  if (opts.day < todayStr || opts.day > addDays(todayStr, opts.maxDaysAhead)) return []
  const earliest = opts.now.getTime() + opts.minNoticeMinutes * 60_000
  const out: Date[] = []
  for (const h of [...opts.hours].sort((a, b) => a.startMinute - b.startMinute)) {
    for (let t = h.startMinute; t + opts.durationMinutes <= h.endMinute; t += opts.stepMinutes) {
      const start = zonedToUtc(opts.day, t, opts.timeZone)
      if (!start || start.getTime() < earliest) continue
      // The end must exist in the same day too (a DST change can shorten the interval).
      const end = new Date(start.getTime() + opts.durationMinutes * 60_000)
      const blocked = end.getTime() + opts.bufferMinutes * 60_000
      if (opts.busy.some((b) => start.getTime() < b.end.getTime() && b.start.getTime() < blocked))
        continue
      if (!out.some((d) => d.getTime() === start.getTime())) out.push(start)
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime())
}
