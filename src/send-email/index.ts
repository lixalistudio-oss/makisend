import * as nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { Config } from "@/config/config";
import { createDatabase } from "@/db/connection";
import { createSendEmailController } from "./send-email.controller";
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
      // Nodemailer types are strict about optional fields (family, tls, etc.)
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

export function createSendEmailModule(config: Config) {
  const db = createDatabase(config.db);
  const transport = new SmtpEmailTransport(config.smtp, config.senderEmail);
  const repository = new SendEmailRepository(db);
  const service = new SendEmailService(transport, repository, config.aesKey);

  return {
    controller: createSendEmailController(),
    service,
    repository,
    transport,
  };
}

export { createSendEmailController } from "./send-email.controller";
export * from "./send-email.types";
export * from "./send-email.dto";
