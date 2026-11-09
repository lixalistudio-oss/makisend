/**
 * What the SMTP form knows without asking the server: the providers people actually use,
 * how to clean what they paste, and how to read the API's answers.
 *
 * The server is the authority (it refuses a bad hostname, port or security with a reason);
 * this file only saves a round trip for what is obvious, and never decides alone.
 */

import type { UiKey } from "@/i18n"

export type SmtpSecurity = "tls" | "starttls"

/** Must match the backend's `SMTP_PORTS` (backend/src/smtp-config/smtp-host.ts): 25 is blocked outbound on Workers. */
export const SMTP_PORTS = [465, 587, 2465, 2525, 2587] as const

export const DEFAULT_PORT = 465

/** 465 and 2465 are TLS from the first byte; every other port starts in clear text and upgrades. */
export function securityForPort(port: number): SmtpSecurity {
  return port === 465 || port === 2465 ? "tls" : "starttls"
}

export type SmtpPort = (typeof SMTP_PORTS)[number]

/** How the provider list is split in the picker, in this order. */
export const PRESET_GROUPS = ["service", "mailbox", "testing"] as const
export type PresetGroup = (typeof PRESET_GROUPS)[number]

export const PRESET_GROUP_LABEL: Record<PresetGroup, UiKey> = {
  service: "smtp.providerGroupService",
  mailbox: "smtp.providerGroupMailbox",
  testing: "smtp.providerGroupTesting",
}

export interface SmtpPreset {
  id: string
  label: string
  group: PresetGroup
  hostname: string
  port: SmtpPort
  security: SmtpSecurity
  /** Other names people type for it (former brand, parent company, product): matched by the search. */
  keywords: readonly string[]
  /** What the person needs to know that the form cannot guess (a translation key). */
  hintKey?: UiKey
}

/** The security always follows the port, so a preset can never pair 587 with implicit TLS. */
function preset(p: Omit<SmtpPreset, "security" | "keywords"> & { keywords?: readonly string[] }): SmtpPreset {
  return { ...p, keywords: p.keywords ?? [], security: securityForPort(p.port) }
}

/**
 * Settings checked against each provider's own documentation. Only ports a Worker can reach
 * (SMTP_PORTS); where a provider offers both, implicit TLS (465) is preferred.
 */
export const PRESETS: readonly SmtpPreset[] = [
  // Sending services
  preset({ id: "cloudflare", label: "Cloudflare Email Service", group: "service", hostname: "smtp.mx.cloudflare.net", port: 465, keywords: ["email sending", "workers"], hintKey: "smtp.hintCloudflare" }),
  preset({ id: "resend", label: "Resend", group: "service", hostname: "smtp.resend.com", port: 465, hintKey: "smtp.hintResend" }),
  preset({ id: "ses", label: "Amazon SES", group: "service", hostname: "email-smtp.us-east-1.amazonaws.com", port: 465, keywords: ["aws", "amazon web services", "simple email service"], hintKey: "smtp.hintSes" }),
  preset({ id: "sendgrid", label: "SendGrid", group: "service", hostname: "smtp.sendgrid.net", port: 587, keywords: ["twilio"], hintKey: "smtp.hintSendgrid" }),
  preset({ id: "mailgun", label: "Mailgun (US)", group: "service", hostname: "smtp.mailgun.org", port: 587, keywords: ["sinch"], hintKey: "smtp.hintMailgun" }),
  preset({ id: "mailgun-eu", label: "Mailgun (EU)", group: "service", hostname: "smtp.eu.mailgun.org", port: 587, keywords: ["sinch", "europe"], hintKey: "smtp.hintMailgun" }),
  preset({ id: "postmark", label: "Postmark", group: "service", hostname: "smtp.postmarkapp.com", port: 587, keywords: ["activecampaign"], hintKey: "smtp.hintPostmark" }),
  preset({ id: "brevo", label: "Brevo", group: "service", hostname: "smtp-relay.brevo.com", port: 587, keywords: ["sendinblue"], hintKey: "smtp.hintBrevo" }),
  preset({ id: "mailjet", label: "Mailjet", group: "service", hostname: "in-v3.mailjet.com", port: 587, keywords: ["sinch"], hintKey: "smtp.hintMailjet" }),
  preset({ id: "smtp2go", label: "SMTP2GO", group: "service", hostname: "mail.smtp2go.com", port: 465, hintKey: "smtp.hintSmtp2go" }),
  preset({ id: "sparkpost", label: "SparkPost", group: "service", hostname: "smtp.sparkpostmail.com", port: 587, keywords: ["bird", "messagebird"], hintKey: "smtp.hintSparkpost" }),
  preset({ id: "mailtrap", label: "Mailtrap (sending)", group: "service", hostname: "live.smtp.mailtrap.io", port: 587, hintKey: "smtp.hintMailtrap" }),
  preset({ id: "scaleway", label: "Scaleway Transactional Email", group: "service", hostname: "smtp.tem.scw.cloud", port: 587, keywords: ["tem", "europe"], hintKey: "smtp.hintScaleway" }),

  // Mailboxes and hosting
  preset({ id: "gmail", label: "Gmail / Google Workspace", group: "mailbox", hostname: "smtp.gmail.com", port: 465, keywords: ["google", "g suite", "gsuite"], hintKey: "smtp.hintGmail" }),
  preset({ id: "microsoft", label: "Microsoft 365", group: "mailbox", hostname: "smtp.office365.com", port: 587, keywords: ["outlook", "office 365", "o365", "exchange online", "hotmail"], hintKey: "smtp.hintMicrosoft" }),
  preset({ id: "zoho", label: "Zoho Mail", group: "mailbox", hostname: "smtp.zoho.com", port: 465, hintKey: "smtp.hintZoho" }),
  preset({ id: "icloud", label: "iCloud Mail", group: "mailbox", hostname: "smtp.mail.me.com", port: 587, keywords: ["apple", "me.com", "mac.com"], hintKey: "smtp.hintIcloud" }),
  preset({ id: "yahoo", label: "Yahoo Mail", group: "mailbox", hostname: "smtp.mail.yahoo.com", port: 465, hintKey: "smtp.hintYahoo" }),
  preset({ id: "fastmail", label: "Fastmail", group: "mailbox", hostname: "smtp.fastmail.com", port: 465, hintKey: "smtp.hintFastmail" }),
  preset({ id: "proton", label: "Proton Mail", group: "mailbox", hostname: "smtp.protonmail.ch", port: 587, keywords: ["protonmail"], hintKey: "smtp.hintProton" }),
  preset({ id: "ovh", label: "OVHcloud (MX Plan)", group: "mailbox", hostname: "ssl0.ovh.net", port: 465, keywords: ["ovh", "mx plan"], hintKey: "smtp.hintOvh" }),
  preset({ id: "infomaniak", label: "Infomaniak", group: "mailbox", hostname: "mail.infomaniak.com", port: 465, keywords: ["kmail"], hintKey: "smtp.hintMailboxAddress" }),
  preset({ id: "hostinger", label: "Hostinger", group: "mailbox", hostname: "smtp.hostinger.com", port: 465, keywords: ["titan"], hintKey: "smtp.hintMailboxAddress" }),

  // Testing
  preset({ id: "mailtrap-sandbox", label: "Mailtrap Sandbox", group: "testing", hostname: "sandbox.smtp.mailtrap.io", port: 587, keywords: ["test", "staging", "fake"], hintKey: "smtp.hintMailtrapSandbox" }),
]

/** Lower case, no accents, no punctuation: "Proton-Mail" and "proton mail" are the same query. */
function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/**
 * Whether a preset answers a search on its name, its host or one of its other names: either the
 * whole query appears as typed ("grid" in SendGrid, "smtp.mail.me.com"), or every word starts one
 * of its words ("mailgun eu"). Starting a word, not appearing anywhere: "me" must not match the
 * "me" inside "messagebird".
 */
export function presetMatches(item: SmtpPreset, query: string): boolean {
  const phrase = normalize(query)
  if (!phrase) return true
  const haystack = normalize([item.label, item.id, item.hostname, ...item.keywords].join(" "))
  if (haystack.includes(phrase)) return true
  const tokens = haystack.split(" ")
  return phrase.split(" ").every((word) => tokens.some((token) => token.startsWith(word)))
}

/** The presets of each group, in PRESET_GROUPS order, empty groups left out. */
export function groupPresets(items: readonly SmtpPreset[]): { group: PresetGroup; items: SmtpPreset[] }[] {
  return PRESET_GROUPS.map((group) => ({ group, items: items.filter((p) => p.group === group) })).filter((g) => g.items.length > 0)
}

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
