/**
 * Every kind of notification the app sends, with default channels.
 * Users can override channels per type in their preferences.
 * Modules add their own entries, e.g. `"invoice.overdue"`.
 */
export const notificationTypes = {
  "member.joined": {
    label: "Someone joins the organization",
    description: "Sent to owners and admins.",
    defaults: { inApp: true, email: false },
  },
  "member.role_changed": {
    label: "Your role changes",
    description: "When an owner or admin changes your role.",
    defaults: { inApp: true, email: true },
  },
  "form.submitted": {
    label: "A form gets a new response",
    description: "Sent to owners and admins.",
    defaults: { inApp: true, email: false },
  },
  "crm.assigned": {
    label: "A customer or deal is assigned to you",
    description: "When someone else makes you the owner.",
    defaults: { inApp: true, email: true },
  },
  "deal.won": {
    label: "A deal is won",
    description: "Sent to owners and admins.",
    defaults: { inApp: true, email: false },
  },
  "task.assigned": {
    label: "A task is assigned to you",
    description: "When someone else assigns you a task.",
    defaults: { inApp: true, email: true },
  },
  "task.commented": {
    label: "Someone comments on your task",
    description: "Tasks you created or are assigned to.",
    defaults: { inApp: true, email: false },
  },
  "task.completed": {
    label: "A task you created is done",
    description: "When someone else completes it.",
    defaults: { inApp: true, email: false },
  },
  "member.removed": {
    label: "You're removed from an organization",
    description: "Email only, since you lose access to the app.",
    defaults: { inApp: false, email: true },
    /** Users can't turn this one off: it's about their own access. */
    required: true,
  },
} satisfies Record<string, NotificationTypeConfig>

export type NotificationTypeConfig = {
  label: string
  description: string
  defaults: { inApp: boolean; email: boolean }
  required?: boolean
}

export type NotificationType = keyof typeof notificationTypes
export type Channels = { inApp: boolean; email: boolean }

export function isNotificationType(t: string): t is NotificationType {
  return Object.hasOwn(notificationTypes, t)
}
