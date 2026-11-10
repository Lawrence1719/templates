import type { NavGroup } from "@templates/shell"
import { Bell, Building2, FolderOpen, LayoutDashboard, ScrollText, UserRound } from "lucide-react"

/**
 * The app's navigation. Each module adds its pages here.
 * `permission` hides the link; the page itself must still check access.
 */
export const nav: NavGroup[] = [
  {
    items: [
      { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard, keywords: ["home"] },
      { title: "Notifications", href: "/notifications", icon: Bell, keywords: ["inbox", "alerts"] },
      {
        title: "Files",
        href: "/files",
        icon: FolderOpen,
        permission: { file: ["read"] },
        keywords: ["upload", "documents", "attachments"],
      },
    ],
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
        title: "Notification settings",
        href: "/settings/notifications",
        icon: Bell,
        keywords: ["email", "preferences", "alerts"],
      },
      {
        title: "Organization",
        href: "/settings/organization",
        icon: Building2,
        keywords: ["team", "members", "invite"],
      },
      {
        title: "Audit log",
        href: "/settings/audit-log",
        icon: ScrollText,
        permission: { audit: ["read"] },
        keywords: ["history", "activity", "security", "logs"],
      },
    ],
  },
]
