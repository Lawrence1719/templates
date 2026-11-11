import { type StockStatus, stockStatus } from "@templates/inventory/definitions"
import { cn } from "@templates/ui/cn"
import Link from "next/link"

export function StockBadge({ onHand, reorderPoint }: { onHand: number; reorderPoint: number }) {
  const s: StockStatus = stockStatus(onHand, reorderPoint)
  if (s === "ok") return null
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-xs whitespace-nowrap",
        s === "out" ? "border-danger/50 text-danger" : "border-foreground/30",
      )}
    >
      {s === "out" ? "Out of stock" : "Low"}
    </span>
  )
}

const TABS = [
  { href: "/inventory", label: "Products" },
  { href: "/inventory/locations", label: "Locations" },
  { href: "/inventory/movements", label: "Movements" },
] as const

/** Section tabs shared by the inventory pages. */
export function InventoryTabs({ current }: { current: (typeof TABS)[number]["href"] }) {
  return (
    <nav aria-label="Inventory" className="flex gap-1 border-b text-sm">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={current === t.href ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 px-3 py-2",
            current === t.href
              ? "border-foreground font-medium"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
