import * as nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { Config, SmtpConfig } from "@/config/config";
import type { EmailInput, EmailSendResult, IEmailTransport } from "./send-email.types";

export class SmtpEmailTransport implements IEmailTransport {
  private readonly transporter: Transporter;
  private readonly senderEmail: string;//

  constructor(config: Config, smtpConfig: SmtpConfig) {
    this.senderEmail = smtpConfig.senderEmail;
    this.transporter = nodemailer.createTransport({
      host: smtpConfig.smtpHostName,
      port: config.port,
      secure: true,
      auth: {
        user: smtpConfig.smtpUsername,
        pass: smtpConfig.smtpPassword,
      },
      family: 4,
      tls: {
        rejectUnauthorized: true,
      },
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  async send(input: EmailInput): Promise<EmailSendResult> {
    const info = await this.transporter.sendMail({
      from: this.senderEmail,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });

    return { messageId: info.messageId };
  }
}

export { createSendEmailController } from "./send-email.controller";
export * from "./send-email.types";
