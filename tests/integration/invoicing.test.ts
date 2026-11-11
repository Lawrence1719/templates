import { listAuditLog } from "@templates/audit"
import { createCustomer, deleteCustomer } from "@templates/crm"
import { db } from "@templates/db"
import {
  INVOICE_STATUSES as DB_STATUSES,
  invoice,
  invoiceLine,
  payment,
} from "@templates/db/schema"
import {
  computeTotals,
  convertQuote,
  createDraft,
  deleteDraft,
  deletePayment,
  fieldErrors,
  getInvoice,
  getPublicInvoice,
  INVOICE_STATUSES,
  type InvoiceInput,
  invoiceInputSchema,
  invoiceState,
  invoiceSummary,
  lineAmount,
  lineTax,
  listInvoices,
  overdueInvoices,
  parsePercent,
  parseQuantity,
  parseSignedMoney,
  recordPayment,
  remindInvoice,
  sendInvoice,
  setQuoteStatus,
  updateDraft,
  updateSettings,
  voidInvoice,
} from "@templates/invoicing"
import { devOutbox, listNotifications } from "@templates/notifications"
import { eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { addMember, newOrgOwner } from "../setup/client"

type Person = { id: string; name: string; email: string }
const ctxOf = (orgId: string, u: Person) => ({
  orgId,
  user: { id: u.id, name: u.name, email: u.email },
})

async function setup() {
  const org = await newOrgOwner("Acme")
  const ctx = ctxOf(org.orgId, org)
  const cust = await createCustomer(ctx, {
    kind: "company",
    name: "Northwind",
    status: "active",
    email: "ap@northwind.example",
  })
  return { org, ctx, cust }
}

const doc = (customerId: string, extra: Partial<InvoiceInput> = {}): InvoiceInput => ({
  customerId,
  issueDate: "2026-11-01",
  dueOn: "2026-12-01",
  currency: "USD",
  lines: [
    { description: "Consulting", quantity: "10", unitPrice: "150", taxRate: "12" },
    { description: "Travel", quantity: "1", unitPrice: "80.50" },
  ],
  ...extra,
})

describe("money math", () => {
  it("parses money, quantities and percentages exactly", () => {
    expect(parseSignedMoney("1,250.5")).toBe(125050)
    expect(parseSignedMoney("-10")).toBe(-1000)
    expect(parseSignedMoney("-0")).toBe(0)
    expect(parseSignedMoney("1.005")).toBeNull()
    expect(parseQuantity("2.5")).toBe(2500)
    expect(parseQuantity("0")).toBeNull()
    expect(parseQuantity("1.0005")).toBeNull()
    expect(parsePercent("12.5%")).toBe(1250)
    expect(parsePercent("101")).toBeNull()
  })

  it("rounds half away from zero, in integers, per line", () => {
    expect(lineAmount(1500, 333)).toBe(500) // 1.5 × $3.33 = $4.995 → $5.00
    expect(lineAmount(1000, -1999)).toBe(-1999)
    expect(lineTax(1005, 1000)).toBe(101) // 10% of $10.05 = $1.005 → $1.01
    expect(lineTax(-1005, 1000)).toBe(-101)
    // Huge values stay exact (BigInt inside).
    expect(lineAmount(9_999_999_999, 99_999_999_999)).toBe(999_999_999_890_000_000_00 / 100)
  })

  it("sums lines into totals", () => {
    const t = computeTotals([
      { quantityMilli: 10_000, unitPriceCents: 15_000, taxRateBp: 1200 },
      { quantityMilli: 1000, unitPriceCents: 8050, taxRateBp: 0 },
      { quantityMilli: 1000, unitPriceCents: -5000, taxRateBp: 1200 },
    ])
    expect(t).toMatchObject({ subtotalCents: 153_050, taxCents: 17_400, totalCents: 170_450 })
  })

  it("rejects bad lines and negative totals with field errors", () => {
    const r = invoiceInputSchema.safeParse(
      doc("00000000-0000-4000-8000-000000000000", {
        dueOn: "2026-10-01",
        lines: [
          { description: "", quantity: "x", unitPrice: "1" },
          { description: "Discount", quantity: "1", unitPrice: "-999" },
        ],
      }),
    )
    expect(r.success).toBe(false)
    if (!r.success)
      expect(fieldErrors(r.error)).toMatchObject({
        dueOn: "Can't be before the issue date",
        "lines.0.description": "Describe the item",
        "lines.0.quantity": "Enter a quantity like 1 or 2.5",
      })
    const negative = invoiceInputSchema.safeParse(
      doc("00000000-0000-4000-8000-000000000000", {
        lines: [{ description: "Discount", quantity: "1", unitPrice: "-5" }],
      }),
    )
    expect(negative.success).toBe(false)
  })

  it("keeps status lists in sync between the module and the schema", () => {
    expect(INVOICE_STATUSES).toEqual(DB_STATUSES)
  })
})

describe("drafts and numbering", () => {
  it("stores computed totals, and numbers documents only when sent, in order", async () => {
    const { ctx, cust } = await setup()
    const a = await createDraft(ctx, "invoice", doc(cust.id))
    expect(a).toMatchObject({
      number: null,
      subtotalCents: 158_050,
      taxCents: 18_000,
      totalCents: 176_050,
    })
    const b = await createDraft(ctx, "invoice", doc(cust.id))
    const q = await createDraft(ctx, "quote", doc(cust.id))

    expect((await sendInvoice(ctx, b.id)).invoice.number).toBe("INV-0001")
    expect((await sendInvoice(ctx, a.id)).invoice.number).toBe("INV-0002")
    expect((await sendInvoice(ctx, q.id)).invoice.number).toBe("QUO-0001")
    await expect(sendInvoice(ctx, a.id)).rejects.toMatchObject({ status: 409 })
  })

  it("never hands out the same number twice, even when sent at the same moment", async () => {
    const { ctx, cust } = await setup()
    const drafts = await Promise.all(
      Array.from({ length: 6 }, () => createDraft(ctx, "invoice", doc(cust.id))),
    )
    const sent = await Promise.all(drafts.map((d) => sendInvoice(ctx, d.id)))
    const numbers = sent.map((s) => s.invoice.number).sort()
    expect(numbers).toEqual([
      "INV-0001",
      "INV-0002",
      "INV-0003",
      "INV-0004",
      "INV-0005",
      "INV-0006",
    ])
  })

  it("lets numbering move forward but never back", async () => {
    const { ctx, cust } = await setup()
    const base = {
      invoicePrefix: "AC-",
      quotePrefix: "Q-",
      nextInvoiceNumber: 1000,
      nextQuoteNumber: 1,
      defaultDueDays: 14,
      defaultTaxRate: "12",
      defaultCurrency: "PHP" as const,
    }
    await updateSettings(ctx, base)
    const d = await createDraft(ctx, "invoice", doc(cust.id))
    expect((await sendInvoice(ctx, d.id)).invoice.number).toBe("AC-1000")
    await expect(updateSettings(ctx, { ...base, nextInvoiceNumber: 5 })).rejects.toMatchObject({
      fieldErrors: { nextInvoiceNumber: "Can't go below 1001" },
    })
  })

  it("edits and deletes drafts only", async () => {
    const { ctx, cust } = await setup()
    const d = await createDraft(ctx, "invoice", doc(cust.id))
    const edited = await updateDraft(
      ctx,
      d.id,
      doc(cust.id, { lines: [{ description: "Retainer", quantity: "1", unitPrice: "500" }] }),
    )
    expect(edited.totalCents).toBe(50_000)
    expect((await getInvoice(ctx, d.id)).lines).toHaveLength(1)

    await sendInvoice(ctx, d.id)
    await expect(updateDraft(ctx, d.id, doc(cust.id))).rejects.toMatchObject({ status: 409 })
    await expect(deleteDraft(ctx, d.id)).rejects.toMatchObject({ status: 409 })
  })

  it("an invoice without a due date is due on receipt", async () => {
    const { ctx, cust } = await setup()
    const d = await createDraft(ctx, "invoice", doc(cust.id, { dueOn: null }))
    expect((await sendInvoice(ctx, d.id)).invoice.dueOn).toBe("2026-11-01")
  })
})

describe("the database locks sent invoices", () => {
  it("refuses to change lines, totals or the customer, or delete it", async () => {
    const { ctx, cust } = await setup()
    const d = await createDraft(ctx, "invoice", doc(cust.id))
    await sendInvoice(ctx, d.id)
    const [line] = await db.select().from(invoiceLine).where(eq(invoiceLine.invoiceId, d.id))
    if (!line) throw new Error("no line")

    await expect(
      db.update(invoiceLine).set({ unitPriceCents: 1 }).where(eq(invoiceLine.id, line.id)),
    ).rejects.toThrow()
    await expect(db.delete(invoiceLine).where(eq(invoiceLine.id, line.id))).rejects.toThrow()
    await expect(
      db.insert(invoiceLine).values({
        orgId: ctx.orgId,
        invoiceId: d.id,
        position: 9,
        description: "Sneaky",
        quantityMilli: 1000,
        unitPriceCents: 1,
        amountCents: 1,
        taxCents: 0,
      }),
    ).rejects.toThrow()
    await expect(
      db.update(invoice).set({ totalCents: 1 }).where(eq(invoice.id, d.id)),
    ).rejects.toThrow()
    await expect(
      db.update(invoice).set({ status: "draft" }).where(eq(invoice.id, d.id)),
    ).rejects.toThrow()
    await expect(db.delete(invoice).where(eq(invoice.id, d.id))).rejects.toThrow()
  })

  it("refuses to record more paid than the total", async () => {
    const { ctx, cust } = await setup()
    const d = await createDraft(ctx, "invoice", doc(cust.id))
    await sendInvoice(ctx, d.id)
    await expect(
      db.update(invoice).set({ amountPaidCents: 999_999_999 }).where(eq(invoice.id, d.id)),
    ).rejects.toThrow()
  })

  it("keeps a customer with invoices from being deleted, with a clear message", async () => {
    const { ctx, cust } = await setup()
    await createDraft(ctx, "invoice", doc(cust.id))
    await expect(deleteCustomer(ctx, cust.id)).rejects.toMatchObject({ status: 409 })
  })
})

describe("payments", () => {
  async function sentInvoice() {
    const s = await setup()
    const d = await createDraft(s.ctx, "invoice", doc(s.cust.id))
    await sendInvoice(s.ctx, d.id)
    return { ...s, inv: d }
  }

  it("tracks partial and full payment, and tells owners and admins when it's paid", async () => {
    const { org, ctx, inv } = await sentInvoice()
    const admin = await addMember(org, "admin")
    const r1 = await recordPayment(ctx, inv.id, {
      amount: "1000",
      paidOn: "2026-11-05",
      method: "bank_transfer",
    })
    expect(invoiceState(r1.invoice, "2026-11-10")).toBe("partial")
    expect(invoiceState(r1.invoice, "2026-12-02")).toBe("overdue")

    await expect(
      recordPayment(ctx, inv.id, { amount: "1000", paidOn: "2026-11-06", method: "cash" }),
    ).rejects.toMatchObject({ fieldErrors: { amount: "Only $760.50 is owed" } })

    const r2 = await recordPayment(ctx, inv.id, {
      amount: "760.50",
      paidOn: "2026-11-06",
      method: "cash",
    })
    expect(invoiceState(r2.invoice, "2026-12-02")).toBe("paid")
    const inbox = await listNotifications({ userId: admin.id, orgId: org.orgId })
    expect(inbox.map((n) => n.type)).toContain("invoice.paid")
  })

  it("never overpays, even with payments recorded at the same moment", async () => {
    const { ctx, inv } = await sentInvoice()
    const tries = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        recordPayment(ctx, inv.id, { amount: "1000", paidOn: "2026-11-05", method: "cash" }),
      ),
    )
    expect(tries.filter((t) => t.status === "fulfilled")).toHaveLength(1)
    const { invoice: after, payments } = await getInvoice(ctx, inv.id)
    expect(after.amountPaidCents).toBe(100_000)
    expect(payments).toHaveLength(1)
  })

  it("refuses payments on drafts and quotes, and future dates", async () => {
    const { ctx, cust } = await setup()
    const d = await createDraft(ctx, "invoice", doc(cust.id))
    await expect(
      recordPayment(ctx, d.id, { amount: "1", paidOn: "2026-11-05", method: "cash" }),
    ).rejects.toMatchObject({
      status: 409,
    })
    await sendInvoice(ctx, d.id)
    await expect(
      recordPayment(ctx, d.id, { amount: "1", paidOn: "2099-01-01", method: "cash" }),
    ).rejects.toMatchObject({
      fieldErrors: { paidOn: "Can't be in the future" },
    })
  })

  it("removing a payment restores the balance; voiding needs payments removed first", async () => {
    const { org, ctx, inv } = await sentInvoice()
    const { payment: p } = await recordPayment(ctx, inv.id, {
      amount: "100",
      paidOn: "2026-11-05",
      method: "card",
    })
    await expect(voidInvoice(ctx, inv.id)).rejects.toMatchObject({ status: 409 })
    if (!p) throw new Error("no payment")
    await deletePayment(ctx, p.id)
    expect((await getInvoice(ctx, inv.id)).invoice.amountPaidCents).toBe(0)
    const voided = await voidInvoice(ctx, inv.id)
    expect(voided?.status).toBe("void")
    await expect(
      recordPayment(ctx, inv.id, { amount: "1", paidOn: "2026-11-05", method: "cash" }),
    ).rejects.toMatchObject({
      status: 409,
    })
    const log = await listAuditLog(org.orgId, { page: 1 })
    expect(log.rows.map((r) => r.action)).toEqual(
      expect.arrayContaining([
        "invoice.sent",
        "payment.recorded",
        "payment.deleted",
        "invoice.voided",
      ]),
    )
  })
})

describe("quotes", () => {
  it("converts an accepted quote into one draft invoice with the same lines", async () => {
    const { org, ctx, cust } = await setup()
    const rep = await addMember(org, "member")
    const q = await createDraft(ctxOf(org.orgId, rep), "quote", doc(cust.id))
    await sendInvoice(ctx, q.id)
    const inv = await convertQuote(ctx, q.id)
    expect(inv).toMatchObject({
      kind: "invoice",
      status: "draft",
      sourceQuoteId: q.id,
      totalCents: 176_050,
    })
    expect((await convertQuote(ctx, q.id))?.id).toBe(inv?.id)
    expect((await getInvoice(ctx, q.id)).invoice.status).toBe("accepted")
    // The rep who wrote the quote hears it was accepted.
    const inbox = await listNotifications({ userId: rep.id, orgId: org.orgId })
    expect(inbox.map((n) => n.type)).toContain("quote.accepted")
  })

  it("expires sent quotes after their valid-until date", async () => {
    const { ctx, cust } = await setup()
    const q = await createDraft(ctx, "quote", doc(cust.id))
    const { invoice: sent } = await sendInvoice(ctx, q.id)
    expect(invoiceState(sent, "2026-11-15")).toBe("sent")
    expect(invoiceState(sent, "2026-12-02")).toBe("expired")
    const declined = await setQuoteStatus(ctx, q.id, "declined")
    expect(declined && invoiceState(declined, "2026-12-02")).toBe("declined")
  })
})

describe("listing and summary", () => {
  it("filters by state the same way the badges read", async () => {
    const { ctx, cust } = await setup()
    const mk = async (dueOn: string, paid?: string) => {
      const d = await createDraft(ctx, "invoice", doc(cust.id, { dueOn }))
      await sendInvoice(ctx, d.id)
      if (paid)
        await recordPayment(ctx, d.id, { amount: paid, paidOn: "2026-11-05", method: "cash" })
      return d
    }
    await createDraft(ctx, "invoice", doc(cust.id))
    await mk("2026-12-01")
    await mk("2026-11-05")
    await mk("2026-11-05", "1760.50")
    const t = "2026-11-11"
    const n = async (state: string) => (await listInvoices(ctx, { state }, t)).total
    expect([await n("draft"), await n("open"), await n("overdue"), await n("paid")]).toEqual([
      1, 1, 1, 1,
    ])
    expect((await overdueInvoices(ctx, t)).map((o) => o.balanceCents)).toEqual([176_050])

    const s = await invoiceSummary(ctx, t)
    expect(s.outstanding).toEqual([{ currency: "USD", cents: 352_100 }])
    expect(s.overdue).toEqual([{ currency: "USD", cents: 176_050, n: 1 }])
  })

  it("searches by number and customer, with LIKE characters literal", async () => {
    const { ctx, cust } = await setup()
    const other = await createCustomer(ctx, {
      kind: "company",
      name: "Fab_rikam",
      status: "active",
    })
    const d = await createDraft(ctx, "invoice", doc(cust.id))
    await sendInvoice(ctx, d.id)
    await createDraft(ctx, "invoice", doc(other.id))
    expect((await listInvoices(ctx, { q: "INV-0001" })).total).toBe(1)
    expect((await listInvoices(ctx, { q: "b_r" })).total).toBe(1)
    expect((await listInvoices(ctx, { q: "_" })).rows.map((r) => r.customerName)).toEqual([
      "Fab_rikam",
    ])
  })
})

describe("customer link and email", () => {
  it("emails the customer a link that shows the sent invoice, never drafts", async () => {
    const { ctx, cust } = await setup()
    const d = await createDraft(ctx, "invoice", doc(cust.id))
    expect(await getPublicInvoice("x".repeat(24))).toBeNull()
    const { invoice: sent, emailed } = await sendInvoice(ctx, d.id, { email: true })
    expect(emailed).toBe(true)
    const mail = devOutbox.filter((m) => m.to === "ap@northwind.example").at(-1)
    expect(mail?.subject).toContain(sent.number)
    expect(mail?.html).toContain(`/i/${sent.publicToken}`)

    const pub = await getPublicInvoice(sent.publicToken ?? "")
    expect(pub?.invoice.number).toBe(sent.number)
    expect(pub?.lines).toHaveLength(2)
    expect(await getPublicInvoice("../../etc/passwd")).toBeNull()
  })

  it("sends reminders only for unpaid invoices of customers with an email", async () => {
    const { ctx, cust } = await setup()
    const noEmail = await createCustomer(ctx, {
      kind: "company",
      name: "Quiet Co",
      status: "active",
    })
    const a = await createDraft(ctx, "invoice", doc(cust.id))
    await sendInvoice(ctx, a.id)
    expect((await remindInvoice(ctx, a.id)).emailed).toBe(true)
    const b = await createDraft(ctx, "invoice", doc(noEmail.id))
    await sendInvoice(ctx, b.id)
    await expect(remindInvoice(ctx, b.id)).rejects.toMatchObject({ status: 409 })
  })
})

describe("org isolation", () => {
  it("can't read, bill, pay or void another org's documents", async () => {
    const a = await setup()
    const b = await setup()
    const d = await createDraft(a.ctx, "invoice", doc(a.cust.id))
    await sendInvoice(a.ctx, d.id)
    const nf = { status: 404 }
    await expect(getInvoice(b.ctx, d.id)).rejects.toMatchObject(nf)
    await expect(updateDraft(b.ctx, d.id, doc(b.cust.id))).rejects.toMatchObject(nf)
    await expect(
      recordPayment(b.ctx, d.id, { amount: "1", paidOn: "2026-11-05", method: "cash" }),
    ).rejects.toMatchObject(nf)
    await expect(voidInvoice(b.ctx, d.id)).rejects.toMatchObject(nf)
    await expect(convertQuote(b.ctx, d.id)).rejects.toMatchObject(nf)
    // Org B can't bill org A's customer.
    await expect(createDraft(b.ctx, "invoice", doc(a.cust.id))).rejects.toMatchObject({
      fieldErrors: { customerId: "Choose a customer from the list" },
    })
    expect((await listInvoices(b.ctx)).total).toBe(0)
    // And the database refuses a payment row pointing at another org's invoice.
    await expect(
      db.insert(payment).values({
        orgId: b.org.orgId,
        invoiceId: d.id,
        amountCents: 1,
        paidOn: "2026-11-05",
        method: "cash",
      }),
    ).rejects.toThrow()
  })
})

describe("permissions", () => {
  it.each([
    ["member", { invoice: ["read", "write"] }, true],
    ["member", { invoice: ["send"] }, false],
    ["member", { invoice: ["void"] }, false],
    ["member", { payment: ["record"] }, false],
    ["admin", { invoice: ["send", "void", "settings"], payment: ["record", "delete"] }, true],
  ] as const)("%s → %j is %s", async (role, permissions, expected) => {
    const org = await newOrgOwner("Acme")
    const m = await addMember(org, role)
    expect(
      (await m.client.call("/organization/has-permission", { permissions })).data.success,
    ).toBe(expected)
  })
})
