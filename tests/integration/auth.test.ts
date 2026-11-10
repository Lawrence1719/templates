import { describe, expect, it } from "vitest"

import { newOrgOwner, newUser, PASSWORD, TestClient } from "../setup/client"

describe("authentication", () => {
  it("signs up, reads the session, and signs out", async () => {
    const { client, email } = await newUser()
    const session = await client.call("/get-session")
    expect(session.data.user.email).toBe(email)

    await client.call("/sign-out", {})
    expect((await client.call("/get-session")).data).toBeNull()
  })

  it("rejects a wrong password", async () => {
    const { email } = await newUser()
    const res = await new TestClient().call("/sign-in/email", {
      email,
      password: "not-the-password",
    })
    expect(res.status).toBe(401)
  })

  it("rejects passwords shorter than 10 characters", async () => {
    const res = await new TestClient().call("/sign-up/email", {
      email: `short-${Date.now()}@example.test`,
      password: "short",
      name: "Short",
    })
    expect(res.status).toBe(400)
  })

  it("never returns the password hash", async () => {
    const { email } = await newUser()
    const res = await new TestClient().call("/sign-in/email", { email, password: PASSWORD })
    expect(JSON.stringify(res.data)).not.toMatch(/password/i)
  })

  it("rate-limits sign-in after 5 attempts per minute", async () => {
    const { email } = await newUser()
    const attacker = new TestClient()
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) {
      statuses.push(
        (await attacker.call("/sign-in/email", { email, password: "wrong-password" })).status,
      )
    }
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401])
    expect(statuses[5]).toBe(429)
  })

  describe("cross-site request forgery", () => {
    async function rawCall(headers: Headers, path: string, body: unknown) {
      const { auth } = await import("@templates/auth")
      return auth.handler(
        new Request(`http://localhost:3000/api/auth${path}`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        }),
      )
    }

    it("blocks a signed-in request from a foreign origin", async () => {
      const org = await newOrgOwner("Acme")
      const h = org.client.headers()
      h.set("origin", "https://evil.example")
      const res = await rawCall(h, "/organization/update", { data: { name: "Pwned" } })
      expect(res.status).toBe(403)
    })

    it("blocks a signed-in request with no origin", async () => {
      const org = await newOrgOwner("Acme")
      const h = org.client.headers()
      h.delete("origin")
      const res = await rawCall(h, "/organization/update", { data: { name: "Pwned" } })
      expect(res.status).toBe(403)
    })
  })
})
