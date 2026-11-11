import {
  type CustomerStatus,
  type DealStage,
  STAGE_LABELS,
  STATUS_LABELS,
} from "@templates/crm/definitions"
import { cn } from "@templates/ui/cn"

export function StatusBadge({ status }: { status: CustomerStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs",
        status === "inactive" && "text-muted-foreground",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          status === "active" && "bg-success",
          status === "lead" && "bg-chart-1",
          status === "inactive" && "bg-muted-foreground",
        )}
      />
      {STATUS_LABELS[status]}
    </span>
  )
}

export function StageBadge({ stage }: { stage: DealStage }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-xs",
        stage === "won" && "border-success/40 text-success",
        stage === "lost" && "text-muted-foreground line-through",
      )}
    >
      {STAGE_LABELS[stage]}
    </span>
  )
}

export function Tags({ tags }: { tags: string[] }) {
  if (!tags.length) return null
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
          {t}
        </span>
      ))}
    </span>
  )
}

const dayFmt = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" })
/** Formats a YYYY-MM-DD date column without shifting it by the viewer's timezone. */
export const formatDay = (d: string) => dayFmt.format(new Date(`${d}T00:00:00Z`))
