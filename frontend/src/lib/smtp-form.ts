/**
 * What the SMTP form knows without asking the server: the providers people actually use,
 * how to clean what they paste, and how to read the API's answers.
 *
 * The server is the authority (it refuses a bad hostname, port or security with a reason);
 * this file only saves a round trip for what is obvious, and never decides alone.
 */

export type SmtpSecurity = "tls" | "starttls"

/** Must match the backend's `SMTP_PORTS` (backend/src/smtp-config/smtp-host.ts): 25 is blocked outbound on Workers. */
export const SMTP_PORTS = [465, 587, 2465, 2525, 2587] as const

export const DEFAULT_PORT = 465

/** 465 and 2465 are TLS from the first byte; every other port starts in clear text and upgrades. */
export function securityForPort(port: number): SmtpSecurity {
  return port === 465 || port === 2465 ? "tls" : "starttls"
}

export interface SmtpPreset {
  id: string
  label: string
  hostname: string
  port: number
  security: SmtpSecurity
  /** What the person needs to know that the form cannot guess. */
  hint?: string
}

export const PRESETS: readonly SmtpPreset[] = [
  {
    id: "zoho",
    label: "Zoho Mail",
    hostname: "smtp.zoho.com",
    port: 465,
    security: "tls",
    hint: "An account in Europe uses smtp.zoho.eu; a paid organisation account uses smtppro.zoho.com. The user name is the full address, and a two-factor account needs an app-specific password.",
  },
  {
    id: "gmail",
    label: "Gmail / Google Workspace",
    hostname: "smtp.gmail.com",
    port: 465,
    security: "tls",
    hint: "Use an app password (the account needs 2-step verification), not the account password.",
  },
  {
    id: "microsoft",
    label: "Microsoft 365",
    hostname: "smtp.office365.com",
    port: 587,
    security: "starttls",
    hint: "SMTP AUTH must be enabled for the mailbox by an administrator.",
  },
  { id: "resend", label: "Resend", hostname: "smtp.resend.com", port: 465, security: "tls", hint: 'The user name is "resend" and the password is an API key.' },
  { id: "sendgrid", label: "SendGrid", hostname: "smtp.sendgrid.net", port: 587, security: "starttls", hint: 'The user name is "apikey" and the password is an API key.' },
  { id: "mailgun", label: "Mailgun", hostname: "smtp.mailgun.org", port: 587, security: "starttls" },
  { id: "cloudflare", label: "Cloudflare Email Service", hostname: "smtp.mx.cloudflare.net", port: 465, security: "tls", hint: 'Sent through the Worker\'s Cloudflare binding, not over SMTP (a Worker cannot reach this host). The user name and password are not used: enter any value. The sender address must use a domain onboarded to Email Sending.' },
] as const

export interface CleanedHostname {
  hostname: string
  /** A port found glued to the hostname (`smtp.zoho.com:465`): moved to the Port field, not left in the name. */
  port?: number
}

/**
 * What a person pastes is often a URL, not a host. Strips the scheme, any path, the user part and
 * surrounding space, lower-cases, and lifts a trailing `:port` out. Anything that is still not a
 * host is left for the server to refuse with its reason.
 */
export function cleanHostname(raw: string): CleanedHostname {
  let value = raw.trim().toLowerCase()
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
  value = value.split(/[/?#]/)[0] ?? ""
  value = value.replace(/^.*@/, "")
  const match = /^(.*):(\d{1,5})$/.exec(value)
  if (match) {
    const port = Number(match[2])
    return { hostname: (match[1] ?? "").replace(/\.$/, ""), ...(port > 0 && port < 65536 ? { port } : {}) }
  }
  return { hostname: value.replace(/\.$/, "") }
}

export type FieldErrors = Partial<Record<"smtpHostname" | "smtpPort" | "smtpSecurity" | "smtpUsername" | "smtpPassword" | "senderEmail", string>>

/** The API's 400 body: `{ error, details: { fieldErrors: { field: string[] } } }` -> one message per field. */
export function fieldErrorsFrom(body: unknown): FieldErrors {
  const raw = (body as { details?: { fieldErrors?: Record<string, string[] | undefined> } } | null)?.details?.fieldErrors
  if (!raw) return {}
  const out: FieldErrors = {}
  for (const key of ["smtpHostname", "smtpPort", "smtpSecurity", "smtpUsername", "smtpPassword", "senderEmail"] as const) {
    const first = raw[key]?.[0]
    if (first) out[key] = first
  }
  return out
}

/** The connection check's answer. `ok: false` always carries the reason and what to do. */
export type CheckResult = { ok: true } | { ok: false; reason: string; message: string }

export function isCheckResult(value: unknown): value is CheckResult {
  if (typeof value !== "object" || value === null) return false
  const v = value as { ok?: unknown; message?: unknown }
  return v.ok === true || (v.ok === false && typeof v.message === "string")
}

/** The manual test send's answer: the message id when the server took it, else what to fix. */
export type SendResult = { ok: true; messageId: string } | { ok: false; reason: string; message: string }

export function isSendResult(value: unknown): value is SendResult {
  if (typeof value !== "object" || value === null) return false
  const v = value as { ok?: unknown; message?: unknown; messageId?: unknown }
  return (v.ok === true && typeof v.messageId === "string") || (v.ok === false && typeof v.message === "string")
}
