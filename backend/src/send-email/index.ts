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
      // Keep a single attempt short: a hung SMTP dial would otherwise block
      // the workflow run until Workflows times it out. Nodemailer's defaults
      // (2min / 30s / 10min) are far too generous for one attempt.
      connectionTimeout: 5_000,
      greetingTimeout: 5_000,
      socketTimeout: 10_000,
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
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
      // Always release the SMTP socket. Nodemailer keeps the connection (and
      // its idle timers) open after sendMail; workerd then cancels the request
      // with "code had hung" once the workflow run returns. close() is
      // safe to call even if the dial never completed.
      this.transporter.close();
    }
  }
}

export { createSendEmailController } from "./send-email.controller";
export * from "./send-email.types";
