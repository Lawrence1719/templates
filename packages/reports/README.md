# Dashboard & reports

KPI tiles, trend charts, ranked breakdowns and an activity feed — driven by small metric definitions each module provides. Every query is scoped to the active organization.

## Features

- **Stat tiles**: value, change vs the previous period (colored by whether up is good), sparkline. Small bases show the absolute change instead of a misleading "+6000%".
- **Trend chart**: one metric per day, crosshair tooltip, recessive grid, and a **"View as table"** for screen readers and exact values
- **Bar lists**: ranked breakdowns with labels and values written out (readable without color or hover)
- **Activity feed** from the audit log
- **Date ranges**: 7 / 30 / 90 days in the URL (`?range=90d`), whole UTC days, compared with the equal period before
- **CSV export**: one row per day, one column per metric, formula-safe cells
- **Built-in metrics** from the auth and audit modules: members (running total), new members, invitations sent, activity, activity by type, most active people
- **Accessible color**: one validated accent for single-series charts (≥ 3:1 on both themes), separate light and dark steps
- **Demo data**: `pnpm --filter @templates/starter seed:demo -- you@example.com` creates an org with 90 days of history

## Define a metric

Count rows of any org-scoped table:

```ts
import { countMetric } from "@templates/reports/server"

export const newCustomersMetric = countMetric({
  id: "new-customers",
  label: "New customers",
  table: customers,
  dateCol: customers.createdAt,
  orgCol: customers.orgId,
})
```

Or write `compute` yourself — return the value, the previous period's value and a daily series:

```ts
import type { Metric } from "@templates/reports"

export const revenueMetric: Metric = {
  id: "revenue",
  label: "Revenue",
  format: "currency",
  async compute(orgId, range) {
    // ...queries filtered by orgId and range.from / range.to
    return { value, previous, series }
  },
}
```

A ranked list is a `Breakdown`: `{ id, label, compute(orgId, range) => [{ label, value }] }`.

## Show it

Add metrics to `apps/starter/src/config/dashboard.ts`:

```ts
export const dashboard = {
  tiles: [membersMetric, newCustomersMetric, revenueMetric, activityMetric],
  trend: "revenue",
  breakdowns: [topCustomers, activityByAction],
}
```

Widgets (`@templates/reports/widgets`): `StatTile`, `TrendChart`, `BarList`, `ActivityFeed`, `RangePicker`.

## Access

Activity data comes from the audit log, so the activity tile, breakdowns and feed only render for roles with `audit: ["read"]`. Gate your own metrics the same way with `can()`.

## Rules the charts follow

One axis per chart · thin 2px lines · rounded bar ends anchored to the baseline · legend not needed for one series (the title names it) · text never uses the series color · tooltips on hover, plus a table view.
