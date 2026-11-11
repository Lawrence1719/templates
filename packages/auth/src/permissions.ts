import { createAccessControl } from "better-auth/plugins/access"
import { defaultStatements } from "better-auth/plugins/organization/access"

/**
 * Every permission in the system, as resource -> actions.
 * Modules extend this list with their own resources (e.g. `customer: ["read", "write"]`).
 */
export const statements = {
  ...defaultStatements,
  billing: ["read", "update"],
  audit: ["read"],
  file: ["read", "upload", "delete"],
  form: ["read", "manage"],
  response: ["read"],
  customer: ["read", "write", "delete"],
  deal: ["read", "write", "delete"],
  project: ["read", "manage"],
  task: ["read", "write", "delete"],
  invoice: ["read", "write", "send", "void", "settings"],
  payment: ["record", "delete"],
  inventory: ["read", "move", "adjust", "manage"],
  order: ["read", "write", "confirm", "fulfill", "cancel"],
  booking: ["read", "write", "manage"],
} as const

export const ac = createAccessControl(statements)

/** Full control, including deleting the organization. One per org at creation. */
export const owner = ac.newRole({
  ...statements,
})

/** Manages people and settings, but cannot delete the org or touch billing. */
export const admin = ac.newRole({
  organization: ["update"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: ["create", "update", "delete"],
  ac: ["read"],
  billing: ["read"],
  audit: ["read"],
  file: ["read", "upload", "delete"],
  form: ["read", "manage"],
  response: ["read"],
  customer: ["read", "write", "delete"],
  deal: ["read", "write", "delete"],
  project: ["read", "manage"],
  task: ["read", "write", "delete"],
  invoice: ["read", "write", "send", "void", "settings"],
  payment: ["record", "delete"],
  inventory: ["read", "move", "adjust", "manage"],
  order: ["read", "write", "confirm", "fulfill", "cancel"],
  booking: ["read", "write", "manage"],
})

/** Regular staff: uses the app, cannot manage the org. */
export const member = ac.newRole({
  ac: ["read"],
  // Members can delete files they uploaded themselves (checked in the files module).
  file: ["read", "upload"],
  // Members can fill in members-only forms; managing forms and reading responses is for admins.
  form: ["read"],
  // Members work customers and deals day to day; deleting them is for admins.
  customer: ["read", "write"],
  deal: ["read", "write"],
  // Members create and work tasks; they can delete tasks they created (checked in the tasks module).
  project: ["read"],
  task: ["read", "write"],
  // Members can see invoices and prepare drafts; sending, voiding and money in are for admins.
  invoice: ["read", "write"],
  // Members receive, issue and transfer stock; counts, corrections and the catalog are for admins.
  inventory: ["read", "move"],
  // Members take, confirm and fulfill orders; cancelling is for admins.
  order: ["read", "write", "confirm", "fulfill"],
  // Members book, confirm and cancel; services, hours and booking settings are for admins.
  booking: ["read", "write"],
})

export const roles = { owner, admin, member }
export type RoleName = keyof typeof roles

export type Permissions = {
  [K in keyof typeof statements]?: (typeof statements)[K][number][]
}
