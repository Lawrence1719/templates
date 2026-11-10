import {
  answerSchema,
  createForm,
  deleteForm,
  type Field,
  fieldErrors,
  fieldIdFrom,
  getFillableForm,
  listForms,
  listSubmissions,
  RATE_LIMIT,
  saveForm,
  setFormStatus,
  submissionsCsv,
  submitForm,
} from "@templates/forms"
import { listNotifications } from "@templates/notifications"
import { describe, expect, it } from "vitest"

import { addMember, newOrgOwner } from "../setup/client"

const FIELDS: Field[] = [
  { id: "name", type: "short_text", label: "Name", required: true },
  { id: "email", type: "email", label: "Email", required: true },
  { id: "budget", type: "number", label: "Budget", required: false, min: 0, max: 100000 },
  { id: "size", type: "select", label: "Team size", required: false, options: ["1-10", "11-50"] },
  {
    id: "services",
    type: "multi_select",
    label: "Services",
    required: false,
    options: ["Web", "Mobile"],
  },
  { id: "agree", type: "checkbox", label: "I agree", required: true },
]
const VALID = {
  name: "Dana",
  email: "dana@example.test",
  budget: "5000",
  size: "1-10",
  services: ["Web"],
  agree: true,
}

let ipSeq = 0
const ip = () => `203.0.113.${++ipSeq}`

async function publishedForm(visibility: "public" | "members" = "public") {
  const org = await newOrgOwner("Acme")
  const ctx = { orgId: org.orgId, user: { id: org.id, name: org.name, email: org.email } }
  const f = await createForm(ctx, "Inquiry")
  await saveForm(ctx, f.id, {
    title: "Inquiry",
    visibility,
    fields: FIELDS,
    confirmation: "Thanks!",
  })
  await setFormStatus(ctx, f.id, "published")
  return { org, ctx, form: f }
}

describe("answer validation", () => {
  const schema = answerSchema(FIELDS)

  it("accepts valid answers and coerces numbers", () => {
    const r = schema.safeParse(VALID)
    expect(r.success && r.data.budget).toBe(5000)
  })

  it.each([
    [{ ...VALID, name: "   " }, "name", "This field is required"],
    [{ ...VALID, email: "nope" }, "email", "Enter a valid email"],
    [{ ...VALID, budget: "-1" }, "budget", "Must be at least 0"],
    [{ ...VALID, size: "999" }, "size", "Choose one of the options"],
    [{ ...VALID, agree: false }, "agree", "This box must be checked"],
  ])("rejects %j at %s", (answers, field, message) => {
    const r = schema.safeParse(answers)
    expect(r.success).toBe(false)
    if (!r.success) expect(fieldErrors(r.error)[field]).toBe(message)
  })

  it("rejects options that aren't on the list and unknown fields", () => {
    expect(schema.safeParse({ ...VALID, services: ["Web", "Hacking"] }).success).toBe(false)
    expect(schema.safeParse({ ...VALID, isAdmin: true }).success).toBe(false)
  })

  it("makes readable, unique field ids", () => {
    expect(fieldIdFrom("Company name", new Set())).toBe("company_name")
    expect(fieldIdFrom("Email", new Set(["email"]))).toBe("email_2")
    expect(fieldIdFrom("¿¿??", new Set())).toBe("field")
  })
})

describe("building forms", () => {
  it("rejects broken definitions with field-level errors", async () => {
    const { ctx, form } = await publishedForm()
    const bad = {
      title: "",
      visibility: "public",
      fields: [
        { id: "a", type: "select", label: "Pick", required: false, options: [] },
        { id: "a", type: "short_text", label: "Dup", required: false },
      ],
    }
    await expect(saveForm(ctx, form.id, bad)).rejects.toMatchObject({
      status: 400,
      fieldErrors: expect.objectContaining({
        title: "Give the form a title",
        "fields.0.options": '"Pick" needs at least one option',
        "fields.1.id": 'Duplicate field id "a"',
      }),
    })
  })

  it("can't publish a form with no fields", async () => {
    const { ctx, form } = await publishedForm()
    await saveForm(ctx, form.id, { title: "Empty", visibility: "public", fields: [] })
    await expect(setFormStatus(ctx, form.id, "published")).rejects.toMatchObject({ status: 409 })
  })

  it("never lets one organization see or change another's forms", async () => {
    const { form } = await publishedForm()
    const other = await newOrgOwner("Other")
    const otherCtx = {
      orgId: other.orgId,
      user: { id: other.id, name: other.name, email: other.email },
    }
    expect(await listForms(otherCtx)).toHaveLength(0)
    await expect(
      saveForm(otherCtx, form.id, { title: "x", visibility: "public", fields: FIELDS }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(listSubmissions(otherCtx, form.id)).rejects.toMatchObject({ status: 404 })
    await expect(deleteForm(otherCtx, form.id)).rejects.toMatchObject({ status: 404 })
  })

  it("uses unguessable share links", async () => {
    const { form } = await publishedForm()
    expect(form.slug).toMatch(/^[A-Za-z0-9_-]{12}$/)
  })
})

describe("submitting", () => {
  it("stores valid answers, shows the confirmation, and notifies admins", async () => {
    const { org, ctx, form } = await publishedForm()
    const r = await submitForm({ slug: form.slug, answers: VALID, ip: ip(), viewerId: null })
    expect(r.confirmation).toBe("Thanks!")

    const { rows } = await listSubmissions(ctx, form.id)
    expect(rows[0]?.data).toEqual({ ...VALID, budget: 5000 })

    const inbox = await listNotifications({ userId: org.id, orgId: org.orgId })
    expect(inbox.map((n) => n.title)).toContain("New response to Inquiry")
  })

  it("returns field errors for invalid answers and stores nothing", async () => {
    const { ctx, form } = await publishedForm()
    await expect(
      submitForm({
        slug: form.slug,
        answers: { ...VALID, email: "bad" },
        ip: ip(),
        viewerId: null,
      }),
    ).rejects.toMatchObject({ status: 400, fieldErrors: { email: "Enter a valid email" } })
    expect((await listSubmissions(ctx, form.id)).rows).toHaveLength(0)
  })

  it("only accepts responses while published", async () => {
    const { ctx, form } = await publishedForm()
    await setFormStatus(ctx, form.id, "draft")
    await expect(
      submitForm({ slug: form.slug, answers: VALID, ip: ip(), viewerId: null }),
    ).rejects.toMatchObject({ status: 404 })
    await setFormStatus(ctx, form.id, "closed")
    await expect(
      submitForm({ slug: form.slug, answers: VALID, ip: ip(), viewerId: null }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it("silently drops bot submissions caught by the honeypot", async () => {
    const { ctx, form } = await publishedForm()
    const r = await submitForm({
      slug: form.slug,
      answers: VALID,
      honeypot: "http://spam.example",
      ip: ip(),
      viewerId: null,
    })
    expect(r.ok).toBe(true)
    expect((await listSubmissions(ctx, form.id)).rows).toHaveLength(0)
  })

  it(`rate-limits to ${RATE_LIMIT.max} submissions per IP per form`, async () => {
    const { form } = await publishedForm()
    const addr = ip()
    for (let i = 0; i < RATE_LIMIT.max; i++)
      await submitForm({ slug: form.slug, answers: VALID, ip: addr, viewerId: null })
    await expect(
      submitForm({ slug: form.slug, answers: VALID, ip: addr, viewerId: null }),
    ).rejects.toMatchObject({ status: 429 })
    // A different visitor is unaffected.
    await expect(
      submitForm({ slug: form.slug, answers: VALID, ip: ip(), viewerId: null }),
    ).resolves.toMatchObject({ ok: true })
  })

  it("doesn't store raw IP addresses", async () => {
    const { ctx, form } = await publishedForm()
    await submitForm({ slug: form.slug, answers: VALID, ip: "198.51.100.7", viewerId: null })
    const { rows } = await listSubmissions(ctx, form.id)
    expect(JSON.stringify(rows)).not.toContain("198.51.100.7")
  })

  it("treats malformed share links as missing", async () => {
    for (const slug of ["", "../etc", "x".repeat(100), "' OR 1=1 --"]) {
      expect((await getFillableForm(slug, null)).state).toBe("missing")
    }
  })
})

describe("members-only forms", () => {
  it("require a signed-in member of the organization", async () => {
    const { org, form } = await publishedForm("members")
    const member = await addMember(org, "member")
    const outsider = await newOrgOwner("Other")

    expect((await getFillableForm(form.slug, null)).state).toBe("sign-in")
    expect((await getFillableForm(form.slug, outsider.id)).state).toBe("missing")
    expect((await getFillableForm(form.slug, member.id)).state).toBe("open")

    await expect(
      submitForm({ slug: form.slug, answers: VALID, ip: ip(), viewerId: null }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      submitForm({ slug: form.slug, answers: VALID, ip: ip(), viewerId: outsider.id }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      submitForm({ slug: form.slug, answers: VALID, ip: ip(), viewerId: member.id }),
    ).resolves.toMatchObject({ ok: true })
  })
})

describe("CSV export", () => {
  it("has one column per field and neutralizes formulas", async () => {
    const { ctx, form } = await publishedForm()
    await submitForm({
      slug: form.slug,
      answers: { ...VALID, name: '=HYPERLINK("http://evil")' },
      ip: ip(),
      viewerId: null,
    })
    const [head, row] = (await submissionsCsv(ctx, form.id)).split("\n")
    expect(head).toBe(
      '"submitted_at","submitted_by","Name","Email","Budget","Team size","Services","I agree"',
    )
    expect(row).toContain(`"'=HYPERLINK(""http://evil"")"`)
    expect(row).toContain('"Web","Yes"')
  })
})

describe("permissions", () => {
  it.each([
    ["member", { form: ["read"] }, true],
    ["member", { form: ["manage"] }, false],
    ["member", { response: ["read"] }, false],
    ["admin", { form: ["manage"] }, true],
    ["admin", { response: ["read"] }, true],
  ] as const)("%s → %j is %s", async (role, permissions, expected) => {
    const org = await newOrgOwner("Acme")
    const m = await addMember(org, role)
    expect(
      (await m.client.call("/organization/has-permission", { permissions })).data.success,
    ).toBe(expected)
  })
})
