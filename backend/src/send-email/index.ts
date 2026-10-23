import type { Transporter } from "nodemailer";
import type { SmtpConfig } from "@/config/config";
import { createSmtpTransport } from "@/smtp-config/smtp-connection";
import type { EmailInput, EmailSendResult, IEmailTransport } from "./send-email.types";

export class SmtpEmailTransport implements IEmailTransport {
  private readonly transporter: Transporter;
  private readonly senderEmail: string;

  constructor(smtpConfig: SmtpConfig) {
    this.senderEmail = smtpConfig.senderEmail;
    this.transporter = createSmtpTransport(smtpConfig);
  }

  async send(input: EmailInput): Promise<EmailSendResult> {
    try {
      const info = await this.transporter.sendMail({
        from: this.senderEmail,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      });

      return { messageId: info.messageId };
    } finally {
      this.transporter.close();
    }
  }
}

export { createSendEmailController } from "./send-email.controller";
export * from "./send-email.types";
