import { PRESETS } from "@/lib/smtp-form"

/**
 * What a provider does with the copies and the reply address, and how many
 * recipients it accepts in one message.
 *
 * Every value here comes from the provider's own documentation, recorded in
 * `docs/SMTP_CAPABILITIES.md` at the repository root. A provider that is not
 * listed was not checked: it gets no warning at all, because a warning nobody
 * verified is worse than none.
 */
export interface SmtpCapabilities {
  /** `single`: only the first address is transmitted. `yes`: all of them are. */
  cc?: "yes" | "single"
  bcc?: "yes" | "single"
  replyTo?: "yes" | "single"
  /** Ceiling for `to` + `cc` + `bcc` together, when the provider publishes one. */
  maxRecipients?: number
}

/** Keyed by preset id (`smtp-form.ts`): Cloudflare, ZeptoMail, SES, Postmark… */
const BY_PRESET_ID: Record<string, SmtpCapabilities> = {
  // The Worker send_email binding carries a single reply address, and Cloudflare
  // refuses a Reply-To header to work around it (E_HEADER_USE_API_FIELD).
  cloudflare: { cc: "yes", bcc: "yes", replyTo: "single", maxRecipients: 50 },
  ses: { cc: "yes", bcc: "yes", replyTo: "yes", maxRecipients: 50 },
  postmark: { cc: "yes", bcc: "yes", replyTo: "yes", maxRecipients: 50 },
  gmail: { cc: "yes", bcc: "yes", replyTo: "yes", maxRecipients: 100 },
  brevo: { cc: "yes", bcc: "yes", replyTo: "yes", maxRecipients: 99 },
  sendgrid: { cc: "yes", bcc: "yes", replyTo: "yes", maxRecipients: 1_000 },
  microsoft: { cc: "yes", bcc: "yes", replyTo: "yes", maxRecipients: 1_000 },
  // Checked, but no documented per-message ceiling was found.
  mailgun: { cc: "yes", bcc: "yes", replyTo: "yes" },
  "mailgun-eu": { cc: "yes", bcc: "yes", replyTo: "yes" },
  mailjet: { cc: "yes", bcc: "yes", replyTo: "yes" },
  resend: { cc: "yes", bcc: "yes", replyTo: "yes" },
}

/** Capabilities of the provider currently selected in the form, if any was documented. */
export function capabilitiesFor(presetId: string | null, hostname: string): SmtpCapabilities | null {
  if (presetId && BY_PRESET_ID[presetId]) return BY_PRESET_ID[presetId]
  // Editing a saved configuration: no preset is selected, but the host still names the provider.
  const host = hostname.trim().toLowerCase()
  const match = PRESETS.find((candidate) => candidate.hostname.toLowerCase() === host)
  return match ? (BY_PRESET_ID[match.id] ?? null) : null
}
