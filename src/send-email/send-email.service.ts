import { pinoLogger } from "@/core/logger";
import { AppError } from "@/core/errors";
import { encrypt } from "@/core/crypto";
import { cleanHtml } from "@/core/html-sanitizer";
import type {
  EmailInput,
  IEmailRepository,
  IEmailTransport,
} from "./send-email.types";
import { userInfo } from "node:os";

export class SendEmailService {
  constructor(
    private readonly emailTransport: IEmailTransport,
    private readonly emailRepository: IEmailRepository,
    private readonly aesKey: string,
    
  ) {}

  async sendEmail(data: EmailInput,userId: string): Promise<{ message: string }> {
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

      const encryptedUserId = await encrypt(userId,this.aesKey);//Encrypt UserID before saving it
      await this.emailRepository.saveEmailLog(
        encryptedUserId,
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
