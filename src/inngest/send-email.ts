import { Inngest, dependencyInjectionMiddleware } from "inngest";
import { pinoLogger } from "@/core/logger";
import { AppError } from "@/core/errors";
import { encrypt } from "@/core/crypto";
import { cleanHtml } from "@/core/html-sanitizer";
import type { IEmailRepository, IEmailTransport } from "@/send-email/send-email.types";

let _inngest: Inngest | null = null;
let _functions: ReturnType<Inngest["createFunction"]>[] | null = null;

let transport: IEmailTransport | null = null;
let repository: IEmailRepository | null = null;
let aesKey: string | null = null;

function initInngest() {
  if (_inngest) return;

  _inngest = new Inngest({
    id: "makisend",
    logger: pinoLogger,
    middleware: [
      dependencyInjectionMiddleware({ transport: transport!, repository: repository!, aesKey: aesKey! }),
    ],
  });

  _functions = [
    _inngest.createFunction(
      {
        id: "send-email",
        triggers: [{ event: "app/send-email" }],
        onFailure: async ({ event, error, repository }) => {
          const { emailId } = event.data as unknown as { emailId: string };
          await repository.saveEmailHistory(emailId, "failed", error.message);
          throw new AppError(500, "Email delivery failed");
        },
        throttle: { limit: 3, period: "1m" },
        retries: 4,
      },
      async ({ event, step, logger, transport, repository, aesKey }) => {
        const startTime = performance.now();
        const emailId = event.data.emailId;

        await step.run("email-received-and-update-history", async () => {
          logger.info({ receiver: event.data.to }, "Email sending request pending");
          await repository.saveEmailHistory(emailId, "received");
        });

        await step.run("processing", async () => {
          pinoLogger.info({ receiver: event.data.to }, "Step: Inngest processing started");
          await repository.saveEmailHistory(emailId, "processing");
        });

        const { cleanedHtml, encryptedReceiver } = await step.run("cleaning-html-input", async () => {
          pinoLogger.info({ receiver: event.data.to }, "Step: cleaning HTML input");
          const cleanedHtml = cleanHtml(event.data.html);
          const encryptedReceiver = await encrypt(event.data.to, aesKey);
          pinoLogger.info({ receiver: event.data.to }, "Step: HTML cleaned and email encrypted");
          await repository.saveEmailHistory(emailId, "cleaned");
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
          await repository.saveEmailHistory(emailId, "sent");
          return { messageId, durationMs };
        });

        await step.run("save-infos-in-db", async () => {
          pinoLogger.info({ smtpId: messageId }, "Step: saving email log to database");
          await repository.saveEmailLog(
            event.data.emailId,
            "system",
            encryptedReceiver,
            event.data.subject,
            messageId,
            new Date().toISOString(),
            durationMs,
          );
          pinoLogger.info({ smtpId: messageId }, "Step: email log saved successfully");
        });

        await step.run("return-json-success-data", async () => {
          pinoLogger.info({ receiver: event.data.to }, "Step: email flow completed");
          return { message: "Email sent successfully" };
        });
      },
    ),
  ];
}

export function configureDeps(
  t: IEmailTransport,
  r: IEmailRepository,
  k: string,
) {
  transport = t;
  repository = r;
  aesKey = k;
  initInngest();
}

export function getInngestClient(): Inngest {
  if (!_inngest) {
    pinoLogger.error("Inngest not initialized — call configureDeps() first");
    throw new AppError(500, "Inngest not initialized — call configureDeps() first");
  }
  return _inngest;
}

export function getFunctions() {
  if (!_functions) {
    pinoLogger.error("Inngest not initialized — call configureDeps() first");
    throw new AppError(500, "Inngest not initialized — call configureDeps() first");
  }
  return _functions;
}
