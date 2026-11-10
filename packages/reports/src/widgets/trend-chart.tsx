"use client"

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { formatValue } from "../format"
import type { ComputedMetric } from "../types"

const day = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" })
const fmtDay = (iso: string) => day.format(new Date(`${iso}T00:00:00Z`))

/** One metric over time: area chart with crosshair tooltip, plus a table view. */
export function TrendChart({ metric }: { metric: ComputedMetric }) {
  const data = metric.series
  return (
    <figure className="rounded-xl border p-5">
      <figcaption className="text-sm font-medium">{metric.label} per day</figcaption>
      <div className="mt-4 h-56">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
            <defs>
              <linearGradient id={`fill-${metric.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.18} />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis
              dataKey="date"
              tickFormatter={fmtDay}
              tickLine={false}
              axisLine={false}
              minTickGap={28}
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            />
            <YAxis
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              width={44}
              tickFormatter={(v: number) => formatValue(v, metric.format)}
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            />
            <Tooltip
              cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
              content={({ active, payload, label }) =>
                active && payload?.[0] ? (
                  <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-md">
                    <p className="text-muted-foreground">{fmtDay(String(label))}</p>
                    <p className="mt-0.5 font-medium tabular-nums">
                      {formatValue(Number(payload[0].value), metric.format)}{" "}
                      {metric.label.toLowerCase()}
                    </p>
                  </div>
                ) : null
              }
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke="var(--chart-1)"
              strokeWidth={2}
              fill={`url(#fill-${metric.id})`}
              activeDot={{ r: 4, stroke: "var(--background)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          View as table
        </summary>
        <div className="mt-2 max-h-56 overflow-y-auto">
          <table className="w-full text-left">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="py-1 font-medium">Date</th>
                <th className="py-1 text-right font-medium">{metric.label}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {[...data].reverse().map((p) => (
                <tr key={p.date}>
                  <td className="py-1">{fmtDay(p.date)}</td>
                  <td className="py-1 text-right tabular-nums">
                    {formatValue(p.value, metric.format)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}
