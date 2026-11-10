import {
  activityByAction,
  activityMetric,
  invitesMetric,
  membersMetric,
  mostActivePeople,
  newMembersMetric,
} from "@templates/reports/server"

/**
 * What the dashboard shows. Each module adds its metrics and breakdowns here,
 * e.g. `revenueMetric` from a sales module.
 */
export const dashboard = {
  /** Stat tiles across the top. */
  tiles: [membersMetric, newMembersMetric, invitesMetric, activityMetric],
  /** Metric drawn as the main trend chart (must also be in `tiles`). */
  trend: "activity",
  breakdowns: [activityByAction, mostActivePeople],
}
