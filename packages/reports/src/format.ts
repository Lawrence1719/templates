import type { MetricFormat } from "./types"

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })
const full = new Intl.NumberFormat("en")

/** 1,284 below 10k, then 12.9K / 4.2M. */
export function formatValue(value: number, format: MetricFormat = "number") {
  if (format === "percent") return `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`
  const n = Math.abs(value) < 10_000 ? full.format(Math.round(value)) : compact.format(value)
  return format === "currency" ? `$${n}` : n
}

/** Relative change, or null when there's no meaningful base. */
export function delta(value: number, previous: number | null) {
  if (previous === null) return null
  if (previous === 0) return value === 0 ? 0 : null
  return (value - previous) / Math.abs(previous)
}
