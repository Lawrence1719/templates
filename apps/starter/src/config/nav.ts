import type { NavGroup } from "@templates/shell"
import {
  Bell,
  Boxes,
  Building2,
  CalendarDays,
  CheckSquare,
  ClipboardList,
  Clock,
  FolderKanban,
  FolderOpen,
  Handshake,
  IdCard,
  LayoutDashboard,
  ReceiptText,
  ScrollText,
  ShoppingCart,
  Store,
  UserRound,
  Users,
  UsersRound,
} from "lucide-react"

/**
 * The app's navigation. Each module adds its pages here.
 * `permission` hides the link; the page itself must still check access.
 */
export const nav: NavGroup[] = [
  {
    items: [
      { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard, keywords: ["home"] },
      { title: "Notifications", href: "/notifications", icon: Bell, keywords: ["inbox", "alerts"] },
    ],
  },
  {
    label: "Sales",
    items: [
      {
        title: "Customers",
        href: "/customers",
        icon: Users,
        permission: { customer: ["read"] },
        keywords: ["crm", "clients", "contacts", "companies", "leads"],
      },
      {
        title: "Deals",
        href: "/deals",
        icon: Handshake,
        permission: { deal: ["read"] },
        keywords: ["pipeline", "sales", "opportunities"],
      },
      {
        title: "Orders",
        href: "/orders",
        icon: ShoppingCart,
        permission: { order: ["read"] },
        keywords: ["sales orders", "fulfillment", "shipping", "delivery"],
      },
      {
        title: "Point of sale",
        href: "/pos",
        icon: Store,
        permission: { pos: ["read"] },
        keywords: ["pos", "till", "register", "checkout", "cash", "receipt", "shift", "retail"],
      },
      {
        title: "Invoices",
        href: "/invoices",
        icon: ReceiptText,
        permission: { invoice: ["read"] },
        keywords: ["billing", "quotes", "estimates", "payments", "receivables"],
      },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        title: "Bookings",
        href: "/bookings",
        icon: CalendarDays,
        permission: { booking: ["read"] },
        keywords: ["appointments", "calendar", "schedule", "reservations", "slots"],
      },
      {
        title: "Memberships",
        href: "/memberships",
        icon: IdCard,
        permission: { membership: ["read"] },
        keywords: ["members", "plans", "subscriptions", "check-in", "gym", "renewals", "passes"],
      },
      {
        title: "Staff",
        href: "/hr",
        icon: UsersRound,
        permission: { hr: ["self"] },
        keywords: ["hr", "employees", "people", "team", "directory", "leave", "timesheets"],
      },
      {
        title: "My time & leave",
        href: "/hr/me",
        icon: Clock,
        permission: { hr: ["self"] },
        keywords: ["clock in", "clock out", "attendance", "vacation", "time off", "leave request"],
      },
      {
        title: "Inventory",
        href: "/inventory",
        icon: Boxes,
        permission: { inventory: ["read"] },
        keywords: ["stock", "products", "warehouse", "sku", "reorder", "locations"],
      },
    ],
  },
  {
    label: "Workspace",
    items: [
      {
        title: "Tasks",
        href: "/tasks",
        icon: CheckSquare,
        permission: { task: ["read"] },
        keywords: ["todo", "to-do", "assignments", "my tasks", "checklist"],
      },
      {
        title: "Projects",
        href: "/projects",
        icon: FolderKanban,
        permission: { project: ["read"] },
        keywords: ["board", "kanban", "progress"],
      },
      {
        title: "Files",
        href: "/files",
        icon: FolderOpen,
        permission: { file: ["read"] },
        keywords: ["upload", "documents", "attachments"],
      },
      {
        title: "Forms",
        href: "/forms",
        icon: ClipboardList,
        permission: { form: ["manage"] },
        keywords: ["survey", "intake", "responses"],
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
