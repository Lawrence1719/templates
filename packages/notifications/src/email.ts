import "server-only"

import { z } from "zod"

export type Email = { to: string; subject: string; html: string; text: string }

const env = () =>
  z
    .object({
      RESEND_API_KEY: z.string().min(1).optional(),
      EMAIL_FROM: z.string().default("Starter <onboarding@resend.dev>"),
      BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
    })
    .parse(process.env)

/** Absolute URL for a path inside the app. */
export const appUrl = (path = "/") => new URL(path, env().BETTER_AUTH_URL).toString()

/**
 * Emails sent while no provider is configured (dev and tests).
 * Printed to the console and kept here so tests can assert on them.
 */
export const devOutbox: Email[] = []

/**
 * Sends through Resend when RESEND_API_KEY is set, otherwise logs.
 * Swap this function to use another provider (SES, Postmark, SMTP).
 */
export async function sendEmail(email: Email): Promise<void> {
  const { RESEND_API_KEY, EMAIL_FROM } = env()
  if (!RESEND_API_KEY) {
    devOutbox.push(email)
    if (devOutbox.length > 100) devOutbox.shift()
    if (process.env.NODE_ENV !== "test")
      console.info(`[email] to=${email.to} subject="${email.subject}"\n${email.text}`)
    return
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: EMAIL_FROM, ...email }),
  })
  if (!res.ok) throw new Error(`Email provider error ${res.status}: ${await res.text()}`)
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  )

/**
 * A plain, readable transactional email. All text is escaped, so names and
 * org titles typed by users can't inject markup or links.
 */
export function renderEmail(opts: {
  subject: string
  heading: string
  paragraphs: string[]
  action?: { label: string; url: string }
  footer?: string
}): Omit<Email, "to"> {
  const action = opts.action
  if (action && !/^https?:\/\//.test(action.url))
    throw new Error("Email action URL must be absolute http(s)")
  const p = (t: string) =>
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3f3f46">${escapeHtml(t)}</p>`
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:12px;padding:32px">
<tr><td>
<h1 style="margin:0 0 16px;font-size:20px;color:#18181b">${escapeHtml(opts.heading)}</h1>
${opts.paragraphs.map(p).join("\n")}
${
  action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600">${escapeHtml(action.label)}</a></p>
<p style="margin:0;font-size:12px;color:#71717a">Or open: ${escapeHtml(action.url)}</p>`
    : ""
}
</td></tr></table>
<p style="margin:16px 0 0;font-size:12px;color:#a1a1aa">${escapeHtml(opts.footer ?? "You received this because of activity in your account.")}</p>
</td></tr></table></body></html>`
  const text = [
    opts.heading,
    "",
    ...opts.paragraphs,
    ...(action ? ["", `${action.label}: ${action.url}`] : []),
  ].join("\n")
  return { subject: opts.subject, html, text }
}
