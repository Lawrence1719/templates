import { z } from "zod"

export const RANGE_PRESETS = { "7d": 7, "30d": 30, "90d": 90 } as const
export type RangePreset = keyof typeof RANGE_PRESETS

export type DateRange = {
  preset: RangePreset
  /** Inclusive start of the current period (UTC midnight). */
  from: Date
  /** Exclusive end of the current period (UTC midnight after today). */
  to: Date
  /** Same-length period immediately before, for deltas. */
  previousFrom: Date
  days: number
}

const DAY = 86_400_000
const startOfUtcDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))

/** Parses `?range=30d` (anything else falls back to 30d). All periods are whole UTC days ending today. */
export function parseRange(value: unknown, now = new Date()): DateRange {
  const preset = z.enum(["7d", "30d", "90d"]).catch("30d").parse(value)
  const days = RANGE_PRESETS[preset]
  const to = new Date(startOfUtcDay(now).getTime() + DAY)
  const from = new Date(to.getTime() - days * DAY)
  return { preset, from, to, previousFrom: new Date(from.getTime() - days * DAY), days }
}

/** Every UTC day in the range as YYYY-MM-DD, oldest first. */
export function rangeDays(range: Pick<DateRange, "from" | "days">) {
  return Array.from({ length: range.days }, (_, i) =>
    new Date(range.from.getTime() + i * DAY).toISOString().slice(0, 10),
  )
}
