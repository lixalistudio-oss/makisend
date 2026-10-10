import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { pinoLogger } from "@/core/logger";
import { cleanHtml } from "@/core/html-sanitizer";
import { createDatabase } from "@/db/connection";
import { SendEmailRepository } from "@/send-email/send-email.repository";
import { resolveTransportFor } from "@/send-email/transport-resolver";
import { classifyEmailError, friendlyErrorMessage } from "@/send-email/error-classifier";
import type { ClassifiableError } from "@/send-email/error-classifier";
import type { Bindings } from "@/index";
import type {
  IEmailRepository,
  SendEmailQueueMessage,
} from "@/send-email/send-email.types";

/** Workflow instance payload — the queue message body. */
export type SendEmailParams = SendEmailQueueMessage["data"];

/**
 * Terminal result of a run. Replaces Inngest's void `onFailure` side effects:
 * the caller (and the tests) can now see what happened without scraping logs.
 */
export type SendEmailRunOutcome =
  | { outcome: "sent"; messageId: string; durationMs: number; attempt: number }
  | { outcome: "requeued"; nextCycle: number; delaySeconds: number }
  | { outcome: "abandoned"; reason: string };

/**
 * Maximum times a message may bounce back onto the Cloudflare Queue after a
 * workflow run dies. Reaching it abandons the send with a final `failed` row —
 * the safety net for errors the classifier cannot type (bugs, unknown codes).
 */
export const MAX_QUEUE_CYCLES = 5;

/** Backoff applied per queue cycle: 1min, 5min, 15min, 30min, 1h. */
const CYCLE_BACKOFF_SECONDS = [60, 300, 900, 1800, 3600];

/** Which delivery attempt this is across queue cycles (cycle 0 = attempt 1). */
function attemptOf(data: SendEmailParams | undefined): number {
  return (data?.queueCycles ?? 0) + 1;
}

function backoffForCycle(cycle: number): number {
  return CYCLE_BACKOFF_SECONDS[Math.min(cycle, CYCLE_BACKOFF_SECONDS.length - 1)];
}

/** What the shared end-of-run resolver needs. */
export interface RunEndDeps {
  emailRepository?: IEmailRepository;
  sendEmailQueue?: Queue<SendEmailQueueMessage>;
}

/**
 * Single decision point for a dead run (SMTP step threw, or any earlier step
 * failed):
 *
 * - permanent failure or cycle cap → final `failed` history row with a
 *   human-readable reason, no re-enqueue — the loop stops here.
 * - transient failure → the original payload goes back onto the Cloudflare
 *   Queue with a `delaySeconds` backoff and `queueCycles + 1`, so the email
 *   gets a fresh workflow instance later unless it keeps failing forever.
 */
export async function resolveSendEmailRunEnd(
  deps: RunEndDeps,
  data: SendEmailParams | undefined,
  failure: ClassifiableError,
): Promise<SendEmailRunOutcome> {
  const { emailRepository, sendEmailQueue } = deps;

  if (!data?.emailId) {
    pinoLogger.error({ failure }, "Email run died: no emailId in the triggering payload");
    return { outcome: "abandoned", reason: "no emailId in payload" };
  }

  const cycles = data.queueCycles ?? 0;
  const friendly = friendlyErrorMessage(failure);

  if (cycles >= MAX_QUEUE_CYCLES) {
    pinoLogger.warn(
      { emailId: data.emailId, cycles, failure },
      "Email delivery abandoned: queue cycle cap reached",
    );
    await emailRepository?.saveEmailHistory(
      data.emailId,
      "failed",
      `Delivery abandoned after ${MAX_QUEUE_CYCLES} queue cycles. Last error: ${friendly}`,
      attemptOf(data),
    );
    return { outcome: "abandoned", reason: "queue cycle cap reached" };
  }

  if (classifyEmailError(failure) === "permanent") {
    pinoLogger.warn(
      { emailId: data.emailId, failure },
      "Email delivery abandoned: permanent failure",
    );
    await emailRepository?.saveEmailHistory(data.emailId, "failed", friendly, attemptOf(data));
    return { outcome: "abandoned", reason: "permanent failure" };
  }

  if (!sendEmailQueue) {
    pinoLogger.error(
      { emailId: data.emailId, failure },
      "Email delivery abandoned: queue binding unavailable for re-enqueue",
    );
    await emailRepository?.saveEmailHistory(
      data.emailId,
      "failed",
      `Cannot re-queue transient failure: queue binding unavailable. Last error: ${friendly}`,
      attemptOf(data),
    );
    return { outcome: "abandoned", reason: "queue binding unavailable" };
  }

  const nextCycle = cycles + 1;
  const delaySeconds = backoffForCycle(cycles);

  try {
    await sendEmailQueue.send(
      { name: "app/send-email", data: { ...data, queueCycles: nextCycle } },
      { delaySeconds },
    );
  } catch (enqueueErr) {
    const reason = enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr);
    pinoLogger.error(
      { emailId: data.emailId, err: enqueueErr },
      "Email delivery abandoned: re-enqueue failed",
    );
    await emailRepository?.saveEmailHistory(
      data.emailId,
      "failed",
      `Failed to re-queue after cycle ${cycles}: ${reason}. Last error: ${friendly}`,
      attemptOf(data),
    );
    return { outcome: "abandoned", reason: "re-enqueue failed" };
  }

  pinoLogger.info(
    { emailId: data.emailId, nextCycle, delaySeconds },
    "Email re-queued for another delivery cycle",
  );
  // Best-effort timeline entry: the send is still alive, so this is an
  // attempt-style row, not a terminal failure.
  try {
    await emailRepository?.saveEmailHistory(
      data.emailId,
      "attempt_failed",
      `Re-queued: next attempt in ${delaySeconds}s (cycle ${nextCycle} of ${MAX_QUEUE_CYCLES}). Last error: ${friendly}`,
    );
  } catch (historyErr) {
    pinoLogger.error(
      { emailId: data.emailId, err: historyErr },
      "Failed to persist re-queue history row",
    );
  }

  return { outcome: "requeued", nextCycle, delaySeconds };
}

/**
 * Durable email delivery pipeline (successor of the Inngest `send-email`
 * function).
 *
 * Parity notes vs the Inngest version:
 * - One SMTP attempt per instance, same five sequential steps.
 * - The SMTP step passes `retries: { limit: 0 }`: Workflows auto-retries
 *   steps by default (5 retries), which would send duplicate emails on a
 *   lost ack and defeat one-attempt-per-run classification.
 * - Failures are classified in-process (try/catch) instead of `onFailure`.
 * - The Cloudflare Queue still owns the retry ladder via queue cycles
 *   (1min→1h backoff, capped at MAX_QUEUE_CYCLES).
 * - Dropped: `retries`/`timeouts.finish` (no Workflows equivalent of the 30s
 *   cancel window — nodemailer socket timeouts in SmtpEmailTransport remain the
 *   hang safety net) and the `send-email-timeout` companion function.
 */
export class SendEmailWorkflow extends WorkflowEntrypoint<Bindings, SendEmailParams> {
  async run(
    event: WorkflowEvent<SendEmailParams>,
    step: WorkflowStep,
  ): Promise<SendEmailRunOutcome> {
    const env = this.env;
    const data = event.payload;
    const startTime = performance.now();
    const emailId = data.emailId;
    const currentAttempt = attemptOf(data);

    const emailRepository = new SendEmailRepository(createDatabase(env.makisend_db));

    try {
      // Fresh transport per event: credential edits apply immediately and each
      // tenant sends with its own SMTP account.
      const transport = await resolveTransportFor(env, data.smtpConfigId ?? undefined);

      await step.do("email-received-and-update-history", async () => {
        pinoLogger.info({ receiver: data.to }, "Email sending request pending");
        await emailRepository.saveEmailHistory(emailId, "received");
      });

      await step.do("processing", async () => {
        pinoLogger.info({ receiver: data.to }, "Step: processing started");
        await emailRepository.saveEmailHistory(emailId, "processing");
      });

      const { cleanedHtml } = await step.do("cleaning-html-input", async () => {
        pinoLogger.info({ receiver: data.to }, "Step: cleaning HTML input");
        const cleanedHtml = cleanHtml(data.html);
        pinoLogger.info({ receiver: data.to }, "Step: HTML cleaned");
        await emailRepository.saveEmailHistory(emailId, "cleaned");
        return { cleanedHtml };
      });

      const { messageId, durationMs } = await step.do(
        "send-mail-via-nodemailer",
        {
          // SMTP is not idempotent: Workflows would otherwise auto-retry this
          // step up to 5 times (default limit), sending duplicate emails when
          // the send succeeded but the ack was lost, and defeating the
          // one-attempt-per-run + queue-cycle classification below.
          retries: { limit: 0, delay: 0, backoff: "constant" },
        },
        async () => {
          pinoLogger.info({ receiver: data.to, attempt: currentAttempt }, "Step: sending email via SMTP");

          let messageId: string;
          try {
            ({ messageId } = await transport.send({
              to: data.to,
              subject: data.subject,
              text: data.text,
              html: cleanedHtml,
            }));
          } catch (err) {
            // Record every failed attempt with its cause, then rethrow so the
            // catch below can classify the error. The dashboard timeline shows
            // each one.
            const reason = err instanceof Error ? err.message : String(err);
            pinoLogger.error({ receiver: data.to, attempt: currentAttempt, err }, "Step: SMTP send failed");
            await emailRepository.saveEmailHistory(emailId, "attempt_failed", reason, currentAttempt);
            throw err;
          }

          const durationMs = Math.round(performance.now() - startTime);
          pinoLogger.info({ smtpId: messageId, durationMs }, "Step: email dispatched via SMTP");
          // Record which attempt succeeded so the timeline shows retries on success too.
          await emailRepository.saveEmailHistory(emailId, "sent", undefined, currentAttempt);
          return { messageId, durationMs };
        },
      );

      await step.do("save-infos-in-db", async () => {
        pinoLogger.info({ smtpId: messageId }, "Step: updating email log in database");
        await emailRepository.completeEmailLog(
          emailId,
          messageId,
          new Date().toISOString(),
          durationMs,
        );
        pinoLogger.info({ smtpId: messageId }, "Step: email log updated successfully");
      });

      return { outcome: "sent", messageId, durationMs, attempt: currentAttempt };
    } catch (err) {
      const failure: ClassifiableError = {
        code: (err as { code?: unknown }).code,
        message: err instanceof Error ? err.message : String(err),
      };
      return resolveSendEmailRunEnd(
        { emailRepository, sendEmailQueue: env.SEND_EMAIL_QUEUE },
        data,
        failure,
      );
    }
  }
}
