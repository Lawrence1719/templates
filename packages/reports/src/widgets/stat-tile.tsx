import { cn } from "@templates/ui/cn"
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react"

import { delta, formatValue } from "../format"
import type { ComputedMetric } from "../types"

/** label · value · delta vs previous period · sparkline. */
export function StatTile({ metric, periodLabel }: { metric: ComputedMetric; periodLabel: string }) {
  const d = delta(metric.value, metric.previous)
  // Percentages on a tiny base are noise (+66000%); show the absolute change instead.
  const small = metric.previous !== null && Math.abs(metric.previous) < 10
  const diff = metric.previous === null ? 0 : metric.value - metric.previous
  const dir = diff === 0 ? "flat" : diff > 0 ? "up" : "down"
  const good = metric.goodDirection ?? "up"
  const tone =
    dir === "flat" || good === "neutral"
      ? "text-muted-foreground"
      : (dir === "up") === (good === "up")
        ? "text-success"
        : "text-danger"
  const Icon = dir === "up" ? ArrowUpRight : dir === "down" ? ArrowDownRight : ArrowRight

  return (
    <div className="flex flex-col gap-3 rounded-xl border p-5">
      <p className="text-sm text-muted-foreground">{metric.label}</p>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-2xl font-semibold tabular-nums">
            {formatValue(metric.value, metric.format)}
          </p>
          <p className={cn("mt-1 flex items-center gap-0.5 text-xs", tone)}>
            {metric.previous === null ? (
              <span className="text-muted-foreground">No earlier data</span>
            ) : small || d === null ? (
              <>
                <Icon className="size-3.5" aria-hidden />
                <span className="tabular-nums">
                  {diff > 0 ? "+" : ""}
                  {formatValue(diff, metric.format)}
                </span>
                <span className="ml-1 text-muted-foreground">vs previous {periodLabel}</span>
              </>
            ) : (
              <>
                <Icon className="size-3.5" aria-hidden />
                <span className="tabular-nums">
                  {d > 0 ? "+" : ""}
                  {(d * 100).toFixed(Math.abs(d) < 0.1 && d !== 0 ? 1 : 0)}%
                </span>
                <span className="ml-1 text-muted-foreground">vs previous {periodLabel}</span>
              </>
            )}
          </p>
        </div>
        <Sparkline points={metric.series.map((p) => p.value)} label={`${metric.label} trend`} />
      </div>
      {metric.hint && <p className="-mt-1 text-xs text-muted-foreground">{metric.hint}</p>}
    </div>
  )
}

/** Tiny trend line: history in the muted ink, the latest point in the accent. */
function Sparkline({ points, label }: { points: number[]; label: string }) {
  if (points.length < 2) return null
  const w = 96
  const h = 32
  const max = Math.max(...points)
  const min = Math.min(...points)
  const span = max - min || 1
  const xy = points.map((v, i) => [
    (i / (points.length - 1)) * (w - 4) + 2,
    h - 3 - ((v - min) / span) * (h - 6),
  ])
  const path = xy.map(([x, y], i) => `${i ? "L" : "M"}${x?.toFixed(1)},${y?.toFixed(1)}`).join(" ")
  const last = xy[xy.length - 1] ?? [0, 0]
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={label}
      className="shrink-0"
    >
      <path
        d={path}
        fill="none"
        stroke="var(--chart-muted)"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <circle
        cx={last[0]}
        cy={last[1]}
        r={3}
        fill="var(--chart-1)"
        stroke="var(--background)"
        strokeWidth={1.5}
      />
    </svg>
  )
}
