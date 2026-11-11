import { type OrderStatus, STATUS_LABELS } from "@templates/orders/definitions"
import { cn } from "@templates/ui/cn"

export function OrderBadge({ status, due }: { status: OrderStatus; due?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs whitespace-nowrap",
        status === "draft" && "border-dashed text-muted-foreground",
        status === "confirmed" && (due ? "border-danger/50 text-danger" : "border-foreground/30"),
        status === "fulfilled" && "border-success/40 text-success",
        status === "cancelled" && "text-muted-foreground line-through",
      )}
    >
      {status === "confirmed" && due ? "Due to ship" : STATUS_LABELS[status]}
    </span>
  )
}
