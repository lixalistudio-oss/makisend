import { pinoLogger } from "@/core/logger";
import { AppError } from "@/core/errors";
import { encrypt } from "@/core/crypto";
import { cleanHtml } from "@/core/html-sanitizer";
import type {
  EmailInput,
  IEmailRepository,
  IEmailTransport,
} from "./send-email.types";

import { UserConfig } from "@/config/config";
export class SendEmailService {
  constructor(
    private readonly emailTransport: IEmailTransport,
    private readonly emailRepository: IEmailRepository,
    private readonly aesKey: string,
    private readonly userConfig : UserConfig
  ) {}

  async sendEmail(data: EmailInput): Promise<{ message: string }> {
    const startTime = performance.now();
    pinoLogger.info({ receiver: data.to }, "Email sending request pending");

    try {
      const cleanedHtml = cleanHtml(data.html);
      const encryptedReceiver = await encrypt(data.to, this.aesKey);
 
      const { messageId } = await this.emailTransport.send({
        to: data.to,
        subject: data.subject,
        text: data.text,
        html: cleanedHtml ,
      });

      const durationMs = Math.round(performance.now() - startTime);

      pinoLogger.info(
        { smtpId: messageId, encryptedReceiver },
        "Email successfully dispatched",
      );


      await this.emailRepository.saveEmailLog(
        this.userConfig.userId,
        encryptedReceiver,
        data.subject,
        messageId,
        new Date().toISOString(),
        durationMs
      );

      return { message:`Email sent successfully` };
    } catch (error) {
      pinoLogger.error({ err: error }, "Service failed to send email");
      throw new AppError(500, "Email delivery failed");
    }
  }
}
