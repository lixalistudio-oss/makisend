import type { WorkflowStep } from "cloudflare:workers";
import { AppError } from "@/core/errors";
import { pinoLogger } from "@/core/logger";
import { cleanHtml } from "@/core/html-sanitizer";
import {
  classifyEmailError,
  friendlyErrorMessage,
  isRecipientHardBounce,
  recipientRejectionReason,
} from "@/send-email/error-classifier";
import type { ClassifiableError } from "@/send-email/error-classifier";
import type {
  EmailToSend,
  IEmailRepository,
  IEmailTransport,
  SendEmailQueueMessage,
} from "@/send-email/send-email.types";

/** One initial SMTP attempt + three retries, 30 seconds apart. */
export const SEND_MAX_RETRIES = 3;
export const SEND_RETRY_DELAY_SECONDS = 30;
export const SEND_MAX_ATTEMPTS = SEND_MAX_RETRIES + 1;

/**
 * Dependencies are injected so the flow can run in-process in tests and inside
 * the durable Workflow in production.
 */
export interface SendEmailFlowDeps {
  repository: IEmailRepository;
  loadEmail: (emailId: string) => Promise<EmailToSend>;
  resolveTransport: (smtpConfigId: string | null) => Promise<IEmailTransport>;
  deadLetterQueue?: Queue<SendEmailQueueMessage>;
  /** Adds the email's recipient to the suppression list after a hard bounce at RCPT TO. */
  suppressRecipient?: (emailId: string, reason: string) => Promise<unknown>;
}

export type SendEmailFlowOutcome =
  | { outcome: "sent"; messageId: string; durationMs: number; attempt: number }
  | { outcome: "rejected"; reason: string; attempt: number }
  | { outcome: "dead_lettered"; reason: string; attempt: number };

const DB_STEP_CONFIG = {
  retries: { limit: 2, delay: "2 seconds", backoff: "constant" },
  timeout: "30 seconds",
} as const;

const SEND_STEP_CONFIG = {
  retries: {
    limit: SEND_MAX_RETRIES,
    delay: `${SEND_RETRY_DELAY_SECONDS} seconds`,
    backoff: "constant",
  },
  timeout: "2 minutes",
} as const;

interface SendReceipt {
  kind: "sent" | "rejected";
  messageId?: string;
  durationMs?: number;
  reason?: string;
  attempt: number;
  /** Set when the recipient's server rejected the address itself: why it gets suppressed. */
  suppressionReason?: string;
}

function toClassifiableError(err: unknown): ClassifiableError {
  return {
    code: (err as { code?: unknown }).code,
    message: err instanceof Error ? err.message : String(err),
  };
}

/**
 * A failed send is permanent when it is an explicit 4xx application error
 * (missing SMTP configuration, missing email content) or when MakiSend's own
 * classifier recognizes an SMTP/config error that retrying cannot fix.
 */
function permanentReason(err: unknown): string | null {
  if (err instanceof AppError && err.statusCode >= 400 && err.statusCode < 500) {
    return err.message;
  }

  const failure = toClassifiableError(err);
  return classifyEmailError(failure) === "permanent"
    ? friendlyErrorMessage(failure)
    : null;
}

function failureReason(err: unknown): string {
  return err instanceof AppError
    ? err.message
    : friendlyErrorMessage(toClassifiableError(err));
}

/**
 * Durable delivery pipeline. The recipient and bodies are loaded from D1 and
 * decrypted inside the step that needs them; no step returns them, because
 * Workflows persists step outputs. Only ids and delivery metadata are returned.
 *
 * Workflow step callbacks return primitives (strings): object returns trigger a
 * false "code had hung" cancellation in workerd (workerd#6925 /
 * workers-sdk#14959).
 */
export async function runSendEmailFlow(
  deps: SendEmailFlowDeps,
  payload: SendEmailQueueMessage,
  step: WorkflowStep,
): Promise<SendEmailFlowOutcome> {
  const emailId = payload.emailId;
  const startedAt = Date.now();
  let lastAttempt = 1;
  let delivered:
    | { messageId: string; durationMs: number; attempt: number }
    | null = null;

  /** Final failure: failed history row, dead-letter queue, terminal outcome. */
  const declareUndeliverable = async (
    reason: string,
    attempt: number,
    summary: string,
    outcome: "rejected" | "dead_lettered" = "dead_lettered",
  ): Promise<SendEmailFlowOutcome> => {
    pinoLogger.error({ emailId, attempt, reason }, "Email delivery abandoned");

    // These are steps so a transient D1/DLQ hiccup is retried; failure to
    // record does not prevent the other side effect from being attempted.
    try {
      await step.do("record-failure", DB_STEP_CONFIG, async () => {
        await deps.repository.saveEmailHistory(
          emailId,
          "failed",
          `${summary}: ${reason}`,
          attempt,
        );
        return emailId;
      });
    } catch (err) {
      pinoLogger.error({ err, emailId }, "Failed to persist final failure history");
    }

    try {
      await step.do("dead-letter", DB_STEP_CONFIG, async () => {
        await deps.deadLetterQueue?.send({ emailId });
        return emailId;
      });
    } catch (err) {
      pinoLogger.error({ err, emailId }, "Failed to publish email to the dead-letter queue");
    }

    return { outcome, reason, attempt };
  };

  try {
    await step.do("email-received-and-update-history", DB_STEP_CONFIG, async () => {
      await deps.repository.saveEmailHistory(emailId, "received");
      return emailId;
    });

    await step.do("processing", DB_STEP_CONFIG, async () => {
      await deps.repository.saveEmailHistory(emailId, "processing");
      return emailId;
    });

    // Validate that the stored email can be rebuilt and sanitized before any
    // SMTP work. Nothing from the email is returned: step outputs are stored
    // by the workflow engine.
    try {
      await step.do("cleaning-html-input", DB_STEP_CONFIG, async () => {
        pinoLogger.info({ emailId }, "Step: cleaning HTML input");
        const email = await deps.loadEmail(emailId);
        cleanHtml(email.html);
        await deps.repository.saveEmailHistory(emailId, "cleaned");
        return emailId;
      });
    } catch (err) {
      return declareUndeliverable(
        failureReason(err),
        1,
        "Could not prepare the email",
      );
    }

    // SMTP is not idempotent, so this step does nothing but send. The `sent`
    // history row and the delivery receipt are written by later steps: a D1
    // failure there can never replay the send and deliver twice.
    let receipt: SendReceipt;
    try {
      const receiptJson = await step.do(
        "send-mail-via-nodemailer",
        SEND_STEP_CONFIG,
        async (ctx) => {
          const attempt = ctx.attempt;
          lastAttempt = attempt;
          pinoLogger.info({ emailId, attempt }, "Step: sending email via SMTP");

          try {
            const email = await deps.loadEmail(emailId);
            const transport = await deps.resolveTransport(email.smtpConfigId);
            const { messageId } = await transport.send({
              to: email.to,
              subject: email.subject,
              text: email.text,
              html: cleanHtml(email.html),
              ...(email.attachments && email.attachments.length > 0 ? { attachments: email.attachments } : {}),
              ...(email.replyTo ? { replyTo: email.replyTo } : {}),
              ...(email.headers ? { headers: email.headers } : {}),
              emailId,
            });

            const durationMs = Date.now() - startedAt;
            pinoLogger.info({ emailId, smtpId: messageId, durationMs }, "Step: email sent");

            const sentReceipt: SendReceipt = {
              kind: "sent",
              messageId,
              durationMs,
              attempt,
            };
            return JSON.stringify(sentReceipt);
          } catch (err) {
            const permanent = permanentReason(err);
            const evidence = {
              ...toClassifiableError(err),
              responseCode: (err as { responseCode?: unknown }).responseCode,
              command: (err as { command?: unknown }).command,
            };
            const reason = permanent ?? toClassifiableError(err).message as string;
            pinoLogger.error(
              { err, emailId, attempt, permanent },
              "Step: SMTP send failed",
            );

            // A history failure must never mask the SMTP error that decides
            // whether the step retries.
            try {
              await deps.repository.saveEmailHistory(
                emailId,
                "attempt_failed",
                reason,
                attempt,
              );
            } catch (historyErr) {
              pinoLogger.error(
                { err: historyErr, emailId, attempt },
                "Failed to record the failed send attempt",
              );
            }

            if (permanent !== null) {
              const rejectedReceipt: SendReceipt = {
                kind: "rejected",
                reason: permanent,
                attempt,
                ...(isRecipientHardBounce(evidence)
                  ? { suppressionReason: recipientRejectionReason(evidence) }
                  : {}),
              };
              return JSON.stringify(rejectedReceipt);
            }

            // Transient: let the Workflow step retry after its configured delay.
            throw err;
          }
        },
      );

      receipt = JSON.parse(receiptJson as string) as SendReceipt;
    } catch (err) {
      // The engine used up every attempt.
      return declareUndeliverable(
        failureReason(err),
        lastAttempt,
        `Delivery abandoned after ${lastAttempt} attempt${lastAttempt === 1 ? "" : "s"}`,
      );
    }

    lastAttempt = receipt.attempt;

    if (receipt.kind === "rejected") {
      if (receipt.suppressionReason && deps.suppressRecipient) {
        const suppressionReason = receipt.suppressionReason;
        // Best effort: failing to record the suppression must not change the outcome.
        try {
          await step.do("suppress-recipient", DB_STEP_CONFIG, async () => {
            await deps.suppressRecipient!(emailId, suppressionReason);
            return emailId;
          });
        } catch (err) {
          pinoLogger.error({ err, emailId }, "Failed to add the recipient to the suppression list");
        }
      }
      return declareUndeliverable(
        receipt.reason ?? "Email was permanently rejected",
        receipt.attempt,
        "Delivery rejected permanently",
        "rejected",
      );
    }

    delivered = {
      messageId: receipt.messageId ?? "",
      durationMs: receipt.durationMs ?? Date.now() - startedAt,
      attempt: receipt.attempt,
    };

    // Post-send bookkeeping gets its own steps. If it fails after the SMTP
    // provider accepted the message, report the send as successful rather than
    // dead-lettering a duplicate-prone email.
    try {
      await step.do("record-sent", DB_STEP_CONFIG, async () => {
        await deps.repository.saveEmailHistory(
          emailId,
          "sent",
          undefined,
          delivered!.attempt,
        );
        return emailId;
      });

      await step.do("save-delivery", DB_STEP_CONFIG, async () => {
        await deps.repository.completeEmailLog(
          emailId,
          delivered!.messageId,
          new Date().toISOString(),
          delivered!.durationMs,
        );
        return emailId;
      });
    } catch (err) {
      pinoLogger.error(
        { err, emailId },
        "Email was sent but delivery bookkeeping failed",
      );
    }

    return { outcome: "sent", ...delivered };
  } catch (err) {
    // Defensive: unexpected failures outside the targeted catches.
    if (delivered) {
      pinoLogger.error(
        { err, emailId },
        "Email was sent but the workflow failed during bookkeeping",
      );
      return { outcome: "sent", ...delivered };
    }

    return declareUndeliverable(
      failureReason(err),
      lastAttempt,
      `Delivery abandoned after ${lastAttempt} attempt${lastAttempt === 1 ? "" : "s"}`,
    );
  }
}
