import type { Transporter } from "nodemailer";
import type { SmtpConfig } from "@/config/config";
import { createSmtpTransport } from "@/smtp-config/smtp-connection";
import { toNodemailerMailboxes } from "@/send-email/mailboxes";
import type { EmailInput, EmailSendResult, IEmailTransport } from "@/send-email/send-email.types";

export class SmtpEmailTransport implements IEmailTransport {
  private readonly transporter: Transporter;
  private readonly senderEmail: string;

  /** `options` exists for tests against a self-signed server; production never passes it. */
  constructor(smtpConfig: SmtpConfig, options?: { rejectUnauthorized?: boolean }) {
    this.senderEmail = smtpConfig.senderEmail;
    this.transporter = options ? createSmtpTransport(smtpConfig, options) : createSmtpTransport(smtpConfig);
  }

  async send(input: EmailInput): Promise<EmailSendResult> {
    try {
      const info = await this.transporter.sendMail({
        from: this.senderEmail,
        to: input.to,
        // Objects, not "Name <address>" strings: nodemailer does its own header
        // quoting, and a pre-formatted string would bypass it.
        ...(input.cc && input.cc.length > 0 ? { cc: toNodemailerMailboxes(input.cc) } : {}),
        ...(input.bcc && input.bcc.length > 0 ? { bcc: toNodemailerMailboxes(input.bcc) } : {}),
        ...(input.replyTo && input.replyTo.length > 0
          ? { replyTo: toNodemailerMailboxes(input.replyTo) }
          : {}),
        subject: input.subject,
        text: input.text,
        html: input.html,
        ...(input.attachments && input.attachments.length > 0
          ? {
              attachments: input.attachments.map((file) => ({
                filename: file.filename,
                contentType: file.contentType,
                content: Buffer.from(file.content),
              })),
            }
          : {}),
      });

      return { messageId: info.messageId };
    } finally {
      this.transporter.close();
    }
  }
}
