"use server"

import { AuthError, requirePermission } from "@templates/auth/guards"
import type { Permissions } from "@templates/auth/permissions"
import {
  convertQuote,
  createDraft,
  deleteDraft,
  deletePayment,
  duplicateInvoice,
  INVOICE_KINDS,
  InvoiceError,
  type InvoiceInput,
  type PaymentInput,
  recordPayment,
  remindInvoice,
  type SettingsInput,
  sendInvoice,
  setQuoteStatus,
  updateDraft,
  updateSettings,
  voidInvoice,
} from "@templates/invoicing"
import { redirect } from "next/navigation"
import { z } from "zod"

export type InvoiceResult =
  | { ok: true; id?: string; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

async function ctxWith(permission: Permissions) {
  const { user, orgId } = await requirePermission(permission)
  return { orgId, user: { id: user.id, name: user.name, email: user.email } }
}

async function run(
  fn: () => Promise<{ id?: string; message?: string } | undefined | void>,
): Promise<InvoiceResult> {
  try {
    const r = await fn()
    return { ok: true, ...(r ?? {}) }
  } catch (e) {
    if (e instanceof InvoiceError)
      return { ok: false, error: e.message, fieldErrors: e.fieldErrors }
    if (e instanceof AuthError) return { ok: false, error: "You don't have permission to do that." }
    throw e
  }
}

const write = { invoice: ["write"] } satisfies Permissions
const kindSchema = z.enum(INVOICE_KINDS)

export async function saveDraftAction(id: string | null, kind: string, input: InvoiceInput) {
  return run(async () => {
    const ctx = await ctxWith(write)
    if (id) return { id: (await updateDraft(ctx, id, input)).id }
    const k = kindSchema.safeParse(kind)
    if (!k.success) throw new InvoiceError("Unknown document type.", 400)
    return { id: (await createDraft(ctx, k.data, input)).id }
  })
}

export async function deleteDraftAction(id: string) {
  const r = await run(async () => {
    await deleteDraft(await ctxWith(write), id)
  })
  if (r.ok) redirect("/invoices")
  return r
}

export async function sendInvoiceAction(id: string, email: boolean) {
  return run(async () => {
    const { invoice, emailed } = await sendInvoice(await ctxWith({ invoice: ["send"] }), id, {
      email: email === true,
    })
    return {
      message: email
        ? emailed
          ? `Sent ${invoice.number} by email.`
          : `${invoice.number} is ready, but it wasn't emailed: the customer has no email address.`
        : `${invoice.number} is ready to share.`,
    }
  })
}

export async function remindInvoiceAction(id: string) {
  return run(async () => {
    await remindInvoice(await ctxWith({ invoice: ["send"] }), id)
    return { message: "Reminder sent." }
  })
}

export async function voidInvoiceAction(id: string) {
  return run(async () => {
    await voidInvoice(await ctxWith({ invoice: ["void"] }), id)
  })
}

export async function duplicateInvoiceAction(id: string) {
  return run(async () => ({ id: (await duplicateInvoice(await ctxWith(write), id)).id }))
}

export async function convertQuoteAction(id: string) {
  return run(async () => {
    const inv = await convertQuote(await ctxWith({ invoice: ["write", "send"] }), id)
    return { id: inv?.id }
  })
}

export async function setQuoteStatusAction(id: string, accepted: boolean) {
  return run(async () => {
    await setQuoteStatus(
      await ctxWith({ invoice: ["send"] }),
      id,
      accepted ? "accepted" : "declined",
    )
  })
}

export async function recordPaymentAction(invoiceId: string, input: PaymentInput) {
  return run(async () => {
    await recordPayment(await ctxWith({ payment: ["record"] }), invoiceId, input)
  })
}

export async function deletePaymentAction(id: string) {
  return run(async () => {
    await deletePayment(await ctxWith({ payment: ["delete"] }), id)
  })
}

export async function saveSettingsAction(input: SettingsInput) {
  return run(async () => {
    await updateSettings(await ctxWith({ invoice: ["settings"] }), input)
  })
}
