import { pinoLogger } from "@/core/logger";
import { AppError } from "@/core/errors";
import { encrypt } from "@/core/crypto";
import { cleanHtml } from "@/core/html-sanitizer";
import { getInngestClient } from "./client";
import type { IEmailRepository, IEmailTransport } from "@/send-email/send-email.types";

interface FunctionContext {
  transport: IEmailTransport;
  emailRepository: IEmailRepository;
  aesKey: string;
}

export function getSendEmailFunction() {
  const inngest = getInngestClient();

  return inngest.createFunction(
    {
      id: "send-email",
      triggers: [{ event: "app/send-email" }],
      onFailure: async ({ event, error }) => {
        const { emailId } = event.data as unknown as { emailId: string };
        const ctx = error as unknown as FunctionContext;
        await ctx.emailRepository.saveEmailHistory(emailId, "failed", error.message);
        throw new AppError(500, "Email delivery failed");
      },
      throttle: { limit: 3, period: "1m" },
      retries: 4,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async ({ event, step, logger, ...ctx }: any) => {
      const { transport, emailRepository, aesKey } = ctx as FunctionContext;
      const startTime = performance.now();
      const emailId = event.data.emailId;

      await step.run("email-received-and-update-history", async () => {
        logger.info({ receiver: event.data.to }, "Email sending request pending");
        await emailRepository.saveEmailHistory(emailId, "received");
      });

      await step.run("processing", async () => {
        pinoLogger.info({ receiver: event.data.to }, "Step: Inngest processing started");
        await emailRepository.saveEmailHistory(emailId, "processing");
      });

      const { cleanedHtml, encryptedReceiver } = await step.run("cleaning-html-input", async () => {
        pinoLogger.info({ receiver: event.data.to }, "Step: cleaning HTML input");
        const cleanedHtml = cleanHtml(event.data.html);
        const encryptedReceiver = await encrypt(event.data.to, aesKey);
        pinoLogger.info({ receiver: event.data.to }, "Step: HTML cleaned and email encrypted");
        await emailRepository.saveEmailHistory(emailId, "cleaned");
        return { cleanedHtml, encryptedReceiver };
      });

      const { messageId, durationMs } = await step.run("send-mail-via-nodemailer", async () => {
        pinoLogger.info({ receiver: event.data.to }, "Step: sending email via nodemailer");
        const { messageId } = await transport.send({
          to: event.data.to,
          subject: event.data.subject,
          text: event.data.text,
          html: cleanedHtml,
        });

        const durationMs = Math.round(performance.now() - startTime);
        pinoLogger.info({ smtpId: messageId, durationMs }, "Step: email dispatched via SMTP");
        await emailRepository.saveEmailHistory(emailId, "sent");
        return { messageId, durationMs };
      });

      await step.run("save-infos-in-db", async () => {
        pinoLogger.info({ smtpId: messageId }, "Step: saving email log to database");
        await emailRepository.saveEmailLog(
          event.data.emailId,
          event.data.userId,
          encryptedReceiver,
          event.data.subject,
          messageId,
          new Date().toISOString(),
          durationMs,
          event.data.apiKeyId,
        );
        pinoLogger.info({ smtpId: messageId }, "Step: email log saved successfully");
      });

      await step.run("return-json-success-data", async () => {
        pinoLogger.info({ receiver: event.data.to }, "Step: email flow completed");
        return { message: "Email sent successfully" };
      });
    },
  );
}
