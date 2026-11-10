import type { DateRange } from "./range"

export type Point = { date: string; value: number }

export type MetricFormat = "number" | "percent" | "currency"

export type MetricResult = {
  value: number
  /** Same metric for the previous period of equal length (null = no comparison). */
  previous: number | null
  /** One point per day in the range. */
  series: Point[]
}

/**
 * A number on the dashboard. Modules define their own, e.g. "Revenue" or "Open orders".
 * `compute` must scope every query to `orgId`.
 */
export type Metric = {
  id: string
  label: string
  format?: MetricFormat
  /** Whether a rise is good news (colors the delta). Default "up". */
  goodDirection?: "up" | "down" | "neutral"
  /** Short note under the value, e.g. "total at end of period". */
  hint?: string
  compute: (orgId: string, range: DateRange) => Promise<MetricResult>
}

export type BreakdownRow = { label: string; value: number }

/** A ranked list, e.g. "Activity by type" or "Top customers". */
export type Breakdown = {
  id: string
  label: string
  compute: (orgId: string, range: DateRange) => Promise<BreakdownRow[]>
}

/** Serializable result handed to client widgets. */
export type ComputedMetric = Omit<Metric, "compute"> & MetricResult
