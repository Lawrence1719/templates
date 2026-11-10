import { cn } from "@templates/ui/cn"
import Link from "next/link"

import { RANGE_PRESETS, type RangePreset } from "../range"

const LABELS: Record<RangePreset, string> = { "7d": "7 days", "30d": "30 days", "90d": "90 days" }

/** Segmented range control. The range lives in the URL (`?range=30d`). */
export function RangePicker({ value, basePath }: { value: RangePreset; basePath: string }) {
  return (
    <div role="group" aria-label="Date range" className="inline-flex rounded-md border p-0.5">
      {(Object.keys(RANGE_PRESETS) as RangePreset[]).map((p) => (
        <Link
          key={p}
          href={p === "30d" ? basePath : `${basePath}?range=${p}`}
          aria-current={p === value ? "true" : undefined}
          className={cn(
            "rounded-[5px] px-3 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground",
            p === value && "bg-accent font-medium text-foreground",
          )}
        >
          {LABELS[p]}
        </Link>
      ))}
    </div>
  )
}
