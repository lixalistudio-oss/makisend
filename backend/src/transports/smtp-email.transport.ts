import type { Transporter } from "nodemailer";
import type { SmtpConfig } from "@/config/config";
import { createSmtpTransport } from "@/smtp-config/smtp-connection";
import { buildMessageId } from "@/bounce-webhooks/correlation";
import { providerFor } from "@/bounce-webhooks/providers";
import type { EmailInput, EmailSendResult, IEmailTransport } from "@/send-email/send-email.types";

/** A header nodemailer writes as is: the tags are JSON, which its RFC 2047 encoding would mangle. */
type PreparedHeader = { prepared: true; value: string };

/**
 * The caller's custom headers, plus the tag the configuration's bounce webhook provider echoes
 * back (SendGrid unique_args, Mailgun variables, Postmark metadata). A header the caller set
 * under the same name is kept as is: the Message-ID then remains the way back to the email.
 */
function headersFor(input: EmailInput, smtpConfig: SmtpConfig): Record<string, string | PreparedHeader> {
  const headers: Record<string, string | PreparedHeader> = { ...(input.headers ?? {}) };
  if (!input.emailId || !smtpConfig.bounceWebhookProvider) return headers;

  const taken = new Set(Object.keys(headers).map((name) => name.toLowerCase()));
  const tags = providerFor(smtpConfig.bounceWebhookProvider).correlationHeaders(input.emailId);
  for (const [name, value] of Object.entries(tags)) {
    // The value is built by MakiSend from an id: one short ASCII line, nothing to escape.
    if (!taken.has(name.toLowerCase())) headers[name] = { prepared: true, value };
  }
  return headers;
}

export class SmtpEmailTransport implements IEmailTransport {
  private readonly transporter: Transporter;
  private readonly senderEmail: string;

  /** `options` exists for tests against a self-signed server; production never passes it. */
  constructor(
    private readonly smtpConfig: SmtpConfig,
    options?: { rejectUnauthorized?: boolean },
  ) {
    this.senderEmail = smtpConfig.senderEmail;
    this.transporter = options ? createSmtpTransport(smtpConfig, options) : createSmtpTransport(smtpConfig);
  }

  async send(input: EmailInput): Promise<EmailSendResult> {
    const headers = headersFor(input, this.smtpConfig);
    try {
      const info = await this.transporter.sendMail({
        from: this.senderEmail,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
        // `<emailId@sender-domain>`: a provider event that reports the Message-ID names the email.
        ...(input.emailId ? { messageId: buildMessageId(input.emailId, this.senderEmail) } : {}),
        ...(input.attachments && input.attachments.length > 0
          ? {
              attachments: input.attachments.map((file) => ({
                filename: file.filename,
                contentType: file.contentType,
                content: Buffer.from(file.content),
              })),
            }
          : {}),
        ...(input.replyTo ? { replyTo: input.replyTo } : {}),
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      });

      return { messageId: info.messageId };
    } finally {
      this.transporter.close();
    }
  }
}
