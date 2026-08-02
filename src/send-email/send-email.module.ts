import * as nodemailer from "nodemailer";
import type { Transporter, TransportOptions } from "nodemailer";
import type { Config } from "@/config/config";
import { createDatabase } from "@/db/connection";
import { SendEmailService } from "./send-email.service";
import { SendEmailRepository } from "./send-email.repository";
import type { EmailInput, EmailSendResult, IEmailTransport } from "./send-email.types";

class SmtpEmailTransport implements IEmailTransport {
  private readonly transporter: Transporter;
  private readonly senderEmail: string;

  constructor(config: Config["smtp"], senderEmail: string) {
    this.senderEmail = senderEmail;
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: true,
      auth: {
        user: config.user,
        pass: config.password,
      },
      family: 4,
      tls: {
        rejectUnauthorized: true,
      },
    } as unknown as TransportOptions);
  }

  async send(input: EmailInput): Promise<EmailSendResult> {
    const info = await this.transporter.sendMail({
      from: this.senderEmail,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });

    return { messageId: info.messageId ?? "unknown" };
  }
}

export function createSendEmailModule(config: Config) {
  const db = createDatabase(config.db);
  const transport = new SmtpEmailTransport(config.smtp, config.senderEmail);
  const repository = new SendEmailRepository(db);
  const service = new SendEmailService(transport, repository, config.aesKey);

  return {
    service,
    repository,
    transport,
  };
}
