import type { NavGroup } from "@templates/shell"
import { Building2, LayoutDashboard, UserRound } from "lucide-react"

/**
 * The app's navigation. Each module adds its pages here.
 * `permission` hides the link; the page itself must still check access.
 */
export const nav: NavGroup[] = [
  {
    items: [{ title: "Dashboard", href: "/dashboard", icon: LayoutDashboard, keywords: ["home"] }],
  },
  {
    label: "Settings",
    items: [
      {
        title: "Profile",
        href: "/settings/profile",
        icon: UserRound,
        keywords: ["account", "name"],
      },
      {
        title: "Organization",
        href: "/settings/organization",
        icon: Building2,
        keywords: ["team", "members", "invite"],
      },
    ],
  },
]
