import { auth } from "@templates/auth"

import { requestHeaders } from "./request-context"

const BASE = "http://localhost:3000"
let ipCounter = 0

export type ApiResult<T = any> = { status: number; data: T }

/**
 * A signed-in browser, minus the browser: keeps cookies and a unique IP
 * (so per-IP rate limits don't leak between tests) and calls the real
 * auth handler in-process.
 */
export class TestClient {
  readonly ip = `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`
  private cookies = new Map<string, string>()

  headers() {
    const h = new Headers({
      origin: BASE,
      "x-forwarded-for": this.ip,
      "content-type": "application/json",
    })
    if (this.cookies.size)
      h.set("cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "))
    return h
  }

  async call<T = any>(path: string, body?: unknown): Promise<ApiResult<T>> {
    const headers = this.headers()
    requestHeaders.current = headers
    const res = await auth.handler(
      new Request(`${BASE}/api/auth${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    )
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";")
      const i = pair?.indexOf("=") ?? -1
      if (!pair || i < 0) continue
      const value = pair.slice(i + 1)
      if (value) this.cookies.set(pair.slice(0, i), value)
      else this.cookies.delete(pair.slice(0, i))
    }
    const text = await res.text()
    return { status: res.status, data: text ? JSON.parse(text) : null }
  }

  /** Makes this client's headers the "current request" for server code (guards, audit). */
  asCurrentRequest() {
    requestHeaders.current = this.headers()
    return this
  }
}

let userCounter = 0
const PASSWORD = "test-password-123"

/** Signs up a fresh user. */
export async function newUser(label = "user") {
  const n = ++userCounter
  const client = new TestClient()
  const email = `${label}-${n}-${Date.now()}@example.test`
  const name = `${label[0]?.toUpperCase()}${label.slice(1)} ${n}`
  const res = await client.call("/sign-up/email", { email, password: PASSWORD, name })
  if (res.status !== 200)
    throw new Error(`sign-up failed: ${res.status} ${JSON.stringify(res.data)}`)
  return { client, email, name, id: res.data.user.id as string }
}

/** A user who owns a new, active organization. */
export async function newOrgOwner(orgName = "Org") {
  const owner = await newUser("owner")
  const slug = `${orgName.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const org = await owner.client.call("/organization/create", { name: orgName, slug })
  if (org.status !== 200) throw new Error(`create org failed: ${JSON.stringify(org.data)}`)
  await owner.client.call("/organization/set-active", { organizationId: org.data.id })
  return { ...owner, orgId: org.data.id as string }
}

/** Invites a new user into the org with a role, accepts, and activates the org. */
export async function addMember(
  owner: { client: TestClient; orgId: string },
  role: "admin" | "member",
) {
  const user = await newUser(role)
  const inv = await owner.client.call("/organization/invite-member", { email: user.email, role })
  if (inv.status !== 200) throw new Error(`invite failed: ${JSON.stringify(inv.data)}`)
  const acc = await user.client.call("/organization/accept-invitation", {
    invitationId: inv.data.id,
  })
  if (acc.status !== 200) throw new Error(`accept failed: ${JSON.stringify(acc.data)}`)
  await user.client.call("/organization/set-active", { organizationId: owner.orgId })
  return { ...user, memberId: acc.data.member.id as string }
}

/** Better Auth answers a refused action with 401, 403 or 400 depending on the route. */
export function isDenied(status: number) {
  return status === 401 || status === 403
}

export { PASSWORD }
