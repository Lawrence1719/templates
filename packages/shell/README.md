# App shell

The signed-in layout every module plugs into: sidebar, top bar, organization switcher, user menu, light/dark theme and a ⌘K command palette. Responsive — the sidebar becomes a drawer below 1024px.

## Features

- **Sidebar** with grouped links, active-page highlight, org switcher at the top
- **Mobile drawer** (accessible dialog, focus-trapped, Esc to close)
- **Top bar**: search button, theme toggle, account menu (profile, org settings, sign out)
- **Command palette** (⌘K / Ctrl+K): jump to any page, switch theme, sign out; matches titles and keywords
- **Permission-aware nav**: links the user's role can't access are hidden
- **Theme**: system / light / dark via `next-themes`, no flash on load
- **Design tokens** in [`@templates/ui/styles.css`](../ui/src/styles.css) — change a few CSS variables to rebrand everything

## Usage

**1. Define your nav** (`src/config/nav.ts`):

```ts
import type { NavGroup } from "@templates/shell"
import { LayoutDashboard, Users } from "lucide-react"

export const nav: NavGroup[] = [
  { items: [{ title: "Dashboard", href: "/dashboard", icon: LayoutDashboard }] },
  {
    label: "Sales",
    items: [
      {
        title: "Customers",
        href: "/customers",
        icon: Users,
        permission: { customer: ["read"] }, // hidden for roles without it
        keywords: ["crm", "clients"],
      },
    ],
  },
]
```

**2. Bind it on the client** (icons can't be passed from server to client components):

```tsx
"use client"
import { AppShell } from "@templates/shell"
import { nav } from "@/config/nav"

export const Shell = (props) => <AppShell nav={nav} {...props} />
```

**3. Wrap your signed-in routes** (`app/(app)/layout.tsx`):

```tsx
const { user, orgId } = await requireOrg()
const [orgs, allowed] = await Promise.all([
  auth.api.listOrganizations({ headers: await headers() }),
  allowedHrefs(nav), // from "@templates/shell/server"
])

return (
  <Shell allowed={allowed} user={user} orgs={orgs} activeOrgId={orgId}>
    {children}
  </Shell>
)
```

**4. Add the theme provider and styles** in the root layout and `globals.css`:

```css
@import "tailwindcss";
@import "@templates/ui/styles.css";
@source "../";
@source "../../../../packages"; /* so Tailwind sees classes inside modules */
```

```tsx
;<html lang="en" suppressHydrationWarning>
  <body>
    <ThemeProvider>{children}</ThemeProvider>
  </body>
</html>
```

## Security note

Hiding a link is for convenience only. Every page and action must still call `requireOrg()` / `protectedAction()` — the shell never replaces server checks.

## Settings pages (in the starter)

- `/settings/profile` — update your name
- `/settings/organization` — rename the org (owner/admin), manage members and invitations
