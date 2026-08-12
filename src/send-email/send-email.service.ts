import { Inngest } from "inngest";
import { pinoLogger } from "@/core/logger";
import { AppError } from "@/core/errors";
import { encrypt } from "@/core/crypto";
import { cleanHtml } from "@/core/html-sanitizer";
import type {
  IEmailRepository,
  IEmailTransport,
} from "./send-email.types";
import type { UserConfig } from "@/config/config";

const inngest = new Inngest({ id: "send-email-flow" , logger: pinoLogger});
export class SendEmailService {
  constructor(
    private readonly emailTransport: IEmailTransport,
    private readonly emailRepository: IEmailRepository,
    private readonly aesKey: string,
    private readonly userConfig : UserConfig
  ) {}
  

  sendEmailDummy = inngest.createFunction(
  { id: "send-email", triggers: { event: "app/user.authenticated" }, onFailure: async ({ event, error }) => {
  const { emailId } = event.data as unknown as { emailId: string };
  await this.emailRepository.saveEmailHistory(emailId, "failed", error.message);
  throw new AppError(500, "Email delivery failed");
},
  throttle: { limit: 3, period: "1m"},
  retries : 4},
  async ({ event, step,logger}) => {

   const startTime = performance.now();
    const emailId = event.data.emailId;
    logger.info({ receiver: event.data.to }, "Email sending request pending");
    await this.emailRepository.saveEmailHistory(emailId, "received");

    await step.run("processing", async () => {
      pinoLogger.info({ receiver: event.data.to }, "Step: Inngest processing started");
      await this.emailRepository.saveEmailHistory(emailId, "processing");
    });
   
    const {cleanedHtml,encryptedReceiver} = await step.run("cleaning-html-input", async () => {
      pinoLogger.info({ receiver: event.data.to }, "Step: cleaning HTML input");
      const cleanedHtml = cleanHtml(event.data.html);
      const encryptedReceiver = await encrypt(event.data.to, this.aesKey);
      pinoLogger.info({ receiver: event.data.to }, "Step: HTML cleaned and email encrypted");
      await this.emailRepository.saveEmailHistory(emailId, "cleaned");
      return {cleanedHtml,encryptedReceiver}
    });

    const {messageId,durationMs} = await step.run("send-mail-via-nodemailer", async () => {
      pinoLogger.info({ receiver: event.data.to }, "Step: sending email via nodemailer");
       const { messageId } = await this.emailTransport.send({
        to: event.data.to,
        subject: event.data.subject,
        text: event.data.text,
        html: cleanedHtml ,
      });
  
      const durationMs = Math.round(performance.now() - startTime);
      pinoLogger.info({ smtpId: messageId, durationMs }, "Step: email dispatched via SMTP");
      await this.emailRepository.saveEmailHistory(emailId, "sent");
      return {messageId,durationMs}
    });
    
    await step.run("save-infos-in-db", async () => {
      pinoLogger.info({ smtpId: messageId }, "Step: saving email log to database");
       await this.emailRepository.saveEmailLog(
        event.data.emailId,
        this.userConfig.userId,
        encryptedReceiver,
        event.data.subject,
        messageId,
        new Date().toISOString(),
        durationMs
      );
      pinoLogger.info({ smtpId: messageId }, "Step: email log saved successfully");
    });

    await step.run("return-json-success-data", async () => {
      pinoLogger.info({ receiver: event.data.to }, "Step: email flow completed");
      return { message:`Email sent successfully` };
    });
  }
);

  


  // async sendEmail(data: EmailInput): Promise<{ message: string }> {
  //   const startTime = performance.now();
  //   pinoLogger.info({ receiver: data.to }, "Email sending request pending");

  //   try {
  //     const cleanedHtml = cleanHtml(data.html);
  //     const encryptedReceiver = await encrypt(data.to, this.aesKey);
 
  //     const { messageId } = await this.emailTransport.send({
  //       to: data.to,
  //       subject: data.subject,
  //       text: data.text,
  //       html: cleanedHtml ,
  //     });

  //     const durationMs = Math.round(performance.now() - startTime);
      
  //     pinoLogger.info(
  //       { smtpId: messageId, encryptedReceiver },
  //       "Email successfully dispatched",
  //     );


  //     await this.emailRepository.saveEmailLog(
  //       this.userConfig.userId,
  //       encryptedReceiver,
  //       data.subject,
  //       messageId,
  //       new Date().toISOString(),
  //       durationMs
  //     );

  //     return { message:`Email sent successfully` };
  //   } catch (error) {
  //     pinoLogger.error({ err: error }, "Service failed to send email");
  //     throw new AppError(500, "Email delivery failed");
  //   }
  // }
}

export function createInngestFunctions(service: SendEmailService) {
  return [service.sendEmailDummy];
}