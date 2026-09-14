import { AppError } from "@/core/errors";
import { encrypt } from "@/core/crypto";
import { cleanHtml } from "@/core/html-sanitizer";
import { pinoLogger } from "@/core/logger";
import { createId } from "@paralleldrive/cuid2";
import type {
  IEmailRepository,
  IEmailTransport,
  EmailInput,
} from "./send-email.types";

export class SendEmailService {
  constructor(
    private readonly emailTransport: IEmailTransport,
    private readonly emailRepository: IEmailRepository,
    private readonly aesKey: string,
  ) {}

  async sendEmail(data: EmailInput): Promise<{ message: string }> {
    const startTime = performance.now();
    const emailId = createId();
    pinoLogger.info({ receiver: data.to }, "Email sending request pending");

    try {
      const cleanedHtml = cleanHtml(data.html);
      const encryptedReceiver = await encrypt(data.to, this.aesKey);

      const { messageId } = await this.emailTransport.send({
        to: data.to,
        subject: data.subject,
        text: data.text,
        html: cleanedHtml,
      });

      const durationMs = Math.round(performance.now() - startTime);

      pinoLogger.info(
        { smtpId: messageId, encryptedReceiver },
        "Email successfully dispatched",
      );

      await this.emailRepository.saveEmailLog(
        emailId,
        "system",
        encryptedReceiver,
        data.subject,
        messageId,
        new Date().toISOString(),
        durationMs,
      );

      return { message: "Email successfully dispatched" };
    } catch (error) {
      pinoLogger.error({ err: error }, "Service failed to send email");
      throw new AppError(500, "Email delivery failed");
    }
  }
}
