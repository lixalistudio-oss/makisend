import { inngest } from "./index";
import { AppError } from "@/core/errors";
import pino

export const sendEmailFunction = inngest.createFunction(
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