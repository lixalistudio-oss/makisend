import { pinoLogger } from "@/core/logger";
import { cleanHtml } from "@/core/html-sanitizer";
import { getInngestClient } from "./client";
import { classifyEmailError, friendlyErrorMessage } from "@/send-email/error-classifier";
import type { ClassifiableError } from "@/send-email/error-classifier";
import type {
  IEmailRepository,
  IEmailTransport,
  SendEmailQueueMessage,
} from "@/send-email/send-email.types";

interface FunctionContext {
  transport?: IEmailTransport;
  resolveTransport: (smtpConfigId?: string) => Promise<IEmailTransport>;
  emailRepository: IEmailRepository;
  aesKey: string;
  attempt?: number;
  sendEmailQueue?: Queue<SendEmailQueueMessage>;
}

/** What the shared end-of-run resolver needs from the DI context. */
interface RunEndContext {
  emailRepository?: IEmailRepository;
  sendEmailQueue?: Queue<SendEmailQueueMessage>;
}

/**
 * One attempt per run.
 *
 * `onFailure` (which owns permanent/transient classification) only fires after
 * ALL retries are exhausted, but Inngest's default retry backoff (15s, 30s,
 * 1m, 2m...) can never fit inside the 30s window below: the run would always
 * be cancelled first, and every failure would fall through to the timeout
 * companion's transient default — re-queueing bad SMTP config forever.
 * With 0 retries a failed attempt fails the run in ~1s, so classification
 * always runs; the queue cycles own the retry ladder.
 */
const RETRIES = 0;

/** Which delivery attempt this is across queue cycles (cycle 0 = attempt 1). */
function attemptOf(data: SendEmailQueueMessage["data"] | undefined): number {
  return (data?.queueCycles ?? 0) + 1;
}

/**
 * Maximum times a message may bounce back onto the Cloudflare Queue after an
 * Inngest run dies. Reaching it abandons the send with a final `failed` row —
 * the safety net for errors the classifier cannot type (bugs, unknown codes).
 */
export const MAX_QUEUE_CYCLES = 5;

/** Backoff applied per queue cycle: 1min, 5min, 15min, 30min, 1h. */
const CYCLE_BACKOFF_SECONDS = [60, 300, 900, 1800, 3600];

function backoffForCycle(cycle: number): number {
  return CYCLE_BACKOFF_SECONDS[Math.min(cycle, CYCLE_BACKOFF_SECONDS.length - 1)];
}

/**
 * Single decision point shared by `onFailure` (retries exhausted) and the
 * timeout companion (30s budget blown, run cancelled):
 *
 * - permanent failure or cycle cap → final `failed` history row with a
 *   human-readable reason, no re-enqueue — the loop stops here.
 * - transient failure → the original payload goes back onto the Cloudflare
 *   Queue with a `delaySeconds` backoff and `queueCycles + 1`, so the email
 *   gets a fresh 30s run later unless it keeps failing forever.
 */
export async function resolveSendEmailRunEnd(
  ctx: RunEndContext,
  data: SendEmailQueueMessage["data"] | undefined,
  failure: ClassifiableError,
): Promise<void> {
  const { emailRepository, sendEmailQueue } = ctx;

  if (!data?.emailId) {
    pinoLogger.error({ failure }, "Email run died: no emailId in the triggering event");
    return;
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
    return;
  }

  if (classifyEmailError(failure) === "permanent") {
    pinoLogger.warn(
      { emailId: data.emailId, failure },
      "Email delivery abandoned: permanent failure",
    );
    await emailRepository?.saveEmailHistory(data.emailId, "failed", friendly, attemptOf(data));
    return;
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
    return;
  }

  const nextCycle = cycles + 1;
  const delaySeconds = backoffForCycle(cycles);

  try {
    // Re-publishing first: the per-cycle event id (`emailId:queueCycles`) lets
    // Inngest's 24h dedup swallow an accidental duplicate if the history write
    // below fails and the failure handler retries.
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
    return;
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
}

export function getSendEmailFunction() {
  const inngest = getInngestClient();

  return inngest.createFunction(
    {
      id: "send-email",
      triggers: [{ event: "app/send-email" }],

      onFailure: async ({ event, error, ...rest }) => {
        // `onFailure` receives an `inngest/function.failed` event, which wraps
        // the original triggering event at `event.data.event` instead of
        // exposing it at the top level.
        const originalEvent = (
          event.data as { event?: { data?: SendEmailQueueMessage["data"] } }
        ).event;
        const failure: ClassifiableError = {
          code: (error as { code?: unknown }).code,
          message: error.message,
        };
        await resolveSendEmailRunEnd(rest as RunEndContext, originalEvent?.data, failure);
      },
      // The 30s execution window: a safety net for hung runs (a wedged SMTP
      // attempt or D1 call). Normal failures fail fast via `retries: 0` and
      // reach `onFailure`; only a silent hang is cancelled and handled by the
      // companion function below.
      timeouts: { finish: "30s" },
      // Global safety cap: smooths bursts (e.g. provider outage) so we never
      // hammer the SMTP provider.
      throttle: { limit: 1000, period: "1m" },
      // Must stay 0: see RETRIES above — retries can never complete inside the
      // window, which would hide every error from onFailure's classification.
      retries: RETRIES,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async ({ event, step, logger, ...ctx }: any) => {
      const { resolveTransport, emailRepository } = ctx as FunctionContext;
      const startTime = performance.now();
      const emailId = event.data.emailId;
      // Attempt numbering spans queue cycles: cycle 0 = attempt 1, cycle 1 =
      // attempt 2, ... (`ctx.attempt` is zero-indexed in-run, always 0 now).
      const currentAttempt =
        ((ctx as FunctionContext).attempt ?? 0) + (event.data.queueCycles ?? 0) + 1;

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
          // Record every failed attempt with its cause, then rethrow so the run
          // fails immediately and `onFailure` can classify the error. The
          // dashboard timeline shows each one. No classification here: errors
          // are only read after the run dies.
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

/** Shape of the `inngest/function.cancelled` payload we care about. */
interface CancelledRunEvent {
  data: {
    function_id: string;
    /** The original `app/send-email` event that started the cancelled run. */
    event?: { data?: SendEmailQueueMessage["data"] };
  };
}

/**
 * Handles runs killed by the 30s execution window (`timeouts.finish`).
 *
 * A timeout cancels the run, which fires `inngest/function.cancelled` — NOT
 * `inngest/function.failed`, so `onFailure` never sees it. The `if` filter
 * keeps this companion limited to the `send-email` function. A cancelled run
 * is by definition a transient outcome: the payload goes back onto the queue.
 */
export function getSendEmailTimeoutFunction() {
  const inngest = getInngestClient();
  const sendEmailFn = getSendEmailFunction();

  return inngest.createFunction(
    {
      id: "send-email-timeout",
      triggers: [
        {
          event: "inngest/function.cancelled",
          if: `event.data.function_id == '${sendEmailFn.id(inngest.id)}'`,
        },
      ],
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async ({ event, ...rest }: any) => {
      const cancelled = event as unknown as CancelledRunEvent;
      const originalData = cancelled.data?.event?.data;

      pinoLogger.warn(
        { emailId: originalData?.emailId, functionId: cancelled.data?.function_id },
        "Send-email run hit the 30s execution window; re-queueing",
      );

      await resolveSendEmailRunEnd(rest as RunEndContext, originalData, {
        message: "The 30s execution window closed before the email was sent",
      });
    },
  );
}
