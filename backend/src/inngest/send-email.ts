import { pinoLogger } from "@/core/logger";
import { cleanHtml } from "@/core/html-sanitizer";
import { getInngestClient } from "./client";
import type { IEmailRepository, IEmailTransport } from "@/send-email/send-email.types";

interface FunctionContext {
  transport?: IEmailTransport;
  resolveTransport: (smtpConfigId?: string) => Promise<IEmailTransport>;
  emailRepository: IEmailRepository;
  aesKey: string;
  attempt?: number;
}

const RETRIES = 4;
const MAX_ATTEMPTS = RETRIES + 1;

export function getSendEmailFunction() {
  const inngest = getInngestClient();

  return inngest.createFunction(
    {
      id: "send-email",
      triggers: [{ event: "app/send-email" }],
      onFailure: async ({ event, error, ...rest }) => {
        // `onFailure` receives an `inngest/function.failed` event, which wraps the
        // original triggering event at `event.data.event` instead of exposing it
        // at the top level.
        const originalEvent = (event.data as { event?: { data?: { emailId?: string } } }).event;
        const emailId = originalEvent?.data?.emailId;
        const { emailRepository } = rest as unknown as Partial<FunctionContext>;

        if (!emailId) {
          pinoLogger.error({ event: event.data, err: error }, "Email delivery failed: no emailId in failure event");
          return;
        }
        // All retries are exhausted at this point, so the attempt count is fixed.
        if (emailRepository) {
          await emailRepository.saveEmailHistory(emailId, "failed", error.message, MAX_ATTEMPTS);
        } else {
          pinoLogger.error({ emailId, err: error, attempts: MAX_ATTEMPTS }, "Email delivery failed");
        }
      },
      // Global safety cap: smooths bursts (e.g. provider outage + many retries)
      // so we never hammer the SMTP provider, while staying high enough to never
      // bottleneck a single email's 5 attempts.
      throttle: { limit: 1000, period: "1m" },
      retries: RETRIES,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async ({ event, step, logger, ...ctx }: any) => {
      const { resolveTransport, emailRepository } = ctx as FunctionContext;
      const startTime = performance.now();
      const emailId = event.data.emailId;
      // Zero-indexed by the SDK: attempt 0 is the first try.
      const currentAttempt = ((ctx as FunctionContext).attempt ?? 0) + 1;

      // Resolve the SMTP configuration the event was queued with (falls back to the
      // active configuration for events queued before smtpConfigId existed).
      const transport = await resolveTransport(event.data.smtpConfigId);

      await step.run("email-received-and-update-history", async () => {
        logger.info({ receiver: event.data.to }, "Email sending request pending");
        await emailRepository.saveEmailHistory(emailId, "received");
      });

      await step.run("processing", async () => {
        pinoLogger.info({ receiver: event.data.to }, "Step: Inngest processing started");
        await emailRepository.saveEmailHistory(emailId, "processing");
      });

      const { cleanedHtml } = await step.run("cleaning-html-input", async () => {
        pinoLogger.info({ receiver: event.data.to }, "Step: cleaning HTML input");
        const cleanedHtml = cleanHtml(event.data.html);
        pinoLogger.info({ receiver: event.data.to }, "Step: HTML cleaned");
        await emailRepository.saveEmailHistory(emailId, "cleaned");
        return { cleanedHtml };
      });

      const { messageId, durationMs } = await step.run("send-mail-via-nodemailer", async () => {
        pinoLogger.info({ receiver: event.data.to, attempt: currentAttempt }, "Step: sending email via nodemailer");

        let messageId: string;
        try {
          ({ messageId } = await transport.send({
            to: event.data.to,
            subject: event.data.subject,
            text: event.data.text,
            html: cleanedHtml,
          }));
        } catch (err) {
          // Record every failed attempt with its cause, then rethrow so Inngest's
          // retries: 4 keeps doing its job. The dashboard timeline shows each one.
          const reason = err instanceof Error ? err.message : String(err);
          pinoLogger.error({ receiver: event.data.to, attempt: currentAttempt, err }, "Step: SMTP send failed");
          await emailRepository.saveEmailHistory(emailId, "attempt_failed", reason, currentAttempt);
          throw err;
        }

        const durationMs = Math.round(performance.now() - startTime);
        pinoLogger.info({ smtpId: messageId, durationMs }, "Step: email dispatched via SMTP");
        // Record which attempt succeeded so the timeline shows retries on success too.
        await emailRepository.saveEmailHistory(emailId, "sent", undefined, currentAttempt);
        return { messageId, durationMs };
      });

      await step.run("save-infos-in-db", async () => {
        pinoLogger.info({ smtpId: messageId }, "Step: updating email log in database");
        await emailRepository.completeEmailLog(
          event.data.emailId,
          messageId,
          new Date().toISOString(),
          durationMs,
        );
        pinoLogger.info({ smtpId: messageId }, "Step: email log updated successfully");
      });

      await step.run("return-json-success-data", async () => {
        pinoLogger.info({ receiver: event.data.to }, "Step: email flow completed");
        return { message: "Email sent successfully" };
      });
    },
  );
}
