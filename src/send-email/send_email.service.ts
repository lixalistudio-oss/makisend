import { pinoLogger } from "../common/logger";
import { AppError } from "../middleware/errors/app_error";
import { Bindings } from "..";
import * as nodemailer from 'nodemailer';
import * as utils from "../common/utils";
import { SendEmailRepository } from "./send_email.repository";

export interface EmailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export class SendEmailService {
  private bindings: Bindings;

  constructor(bindings: Bindings) {
    this.bindings = bindings;

  }

  async sendEmail(data: EmailInput): Promise<{ message: string }> {
    // Start stopwatch to track performance
    const startTime = performance.now(); 
    let sendEmailRepo: SendEmailRepository | null = null; 
    pinoLogger.info({ receiver: data.to }, "Email sending request pending");

    // Configure the mail transporter
    const transporter = nodemailer.createTransport({
      host: this.bindings.HOST,
      port: this.bindings.PORT,
      secure: true,
      auth: {
        user: this.bindings.SMTP_USER,
        pass: this.bindings.SMTP_PASSWORD
      },
      // CRITICAL: Force IPv4 to bypass the local workerd network warning
      family: 4,
      tls: {
        rejectUnauthorized: true // Prevents Man-in-the-Middle attacks
      }
    } as any);

    try {
      sendEmailRepo = new SendEmailRepository(this.bindings.makisend_db);
      const { to, subject, text, html } = data;
      
      // Sanitize dirty HTML from the request
      const cleanedHtml = utils.cleanHtml(html);

      // Encrypt the email address of the receiver
    const encryptedReceiver = await utils.encrypt(to, this.bindings.AES_256_KEY);

      // Dispatch the email via SMTP
      const info = await transporter.sendMail({
        from: this.bindings.SENDER_EMAIL,
        to,
        subject,
        text,
        html: cleanedHtml,
      });

      // Calculate the time spent by nodemailer to send the email
      const durationMs = Math.round(performance.now() - startTime);

      // Log the success details of the message 
      pinoLogger.info(
        { smtpId: info.messageId, EncryptedReceiver: encryptedReceiver }, 
        'Email successfully dispatched through nodemailer'
      );

      // Save important email transaction data to the D1 database through the Repository
      await sendEmailRepo.saveEmailLog(
        encryptedReceiver,
        subject,
        info.messageId,
        new Date().toISOString(),
        durationMs
      );

      return { message: 'Email sent successfully' };
    } catch (error) {
      pinoLogger.error({ err: error }, 'Service failed to send email');
      throw new AppError(500, 'Email delivery failed');
    }
  }
}
