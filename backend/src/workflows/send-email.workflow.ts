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

/**
 * Workflow instance payload — exactly the Cloudflare Queue message body the
 * controller produced. Nothing is added or stripped between HTTP → Queue →
 * Workflow, so the consumer can hand `msg.body.data` straight to `create()`.
 */
export type SendEmailParams = SendEmailQueueMessage["data"];

/**
 * Terminal result of a run. Returned (not thrown) so the Workflows runtime
 * records the instance as *completed* with a typed payload, and tests can
 * assert on the decision without scraping logs. Replaces Inngest's void
 * `onFailure` side effects.
 */
export type SendEmailRunOutcome =
  /** SMTP accepted the message; the email log is complete. */
  | { outcome: "sent"; messageId: string; durationMs: number; attempt: number }
  /** Transient failure — payload re-enqueued with a backoff for another run. */
  | { outcome: "requeued"; nextCycle: number; delaySeconds: number }
  /** Terminal failure — a final `failed` history row was written, loop stopped. */
  | { outcome: "abandoned"; reason: string };

/**
 * Maximum times a message may bounce back onto the Cloudflare Queue after a
 * workflow run dies. Reaching it abandons the send with a final `failed` row —
 * the safety net for errors the classifier cannot type (bugs, unknown codes).
 */
export const MAX_QUEUE_CYCLES = 5;

/**
 * Backoff applied per queue cycle before the message is redelivered:
 * cycle 0→1 waits 60s, 1→2 waits 300s, …, 4→5 waits 3600s.
 * Indexed by the *current* cycle; clamped so a hypothetical cycle ≥ 5
 * reuses the last (1h) entry instead of reading past the array.
 */
const CYCLE_BACKOFF_SECONDS = [60, 300, 900, 1800, 3600];

/**
 * Human-facing attempt number shown on the dashboard timeline.
 * Queue cycle 0 is the first attempt, cycle 1 the second, and so on.
 */
function attemptOf(data: SendEmailParams | undefined): number {
  return (data?.queueCycles ?? 0) + 1;
}

/** Clamp-safe lookup: never returns undefined even if `cycle` exceeds the ladder. */
function backoffForCycle(cycle: number): number {
  return CYCLE_BACKOFF_SECONDS[Math.min(cycle, CYCLE_BACKOFF_SECONDS.length - 1)];
}

/** Collaborators the end-of-run resolver needs; optional so tests can stub either. */
export interface RunEndDeps {
  emailRepository?: IEmailRepository;
  sendEmailQueue?: Queue<SendEmailQueueMessage>;
}

/**
 * Single decision point for a dead run (SMTP step threw, or any earlier step
 * failed). Decides between giving up and retrying:
 *
 * 1. No `emailId` → abandon (nothing to track or retry against).
 * 2. Queue-cycle cap reached → abandon with a final `failed` row. This is the
 *    hard stop that keeps unknown/transient-looking bugs from looping forever.
 * 3. Classifier says `permanent` (auth, TLS, DNS, config, 5xx) → abandon
 *    immediately with a human-readable reason. Retrying cannot fix these.
 * 4. Queue binding missing → abandon (cannot retry without the queue).
 * 5. Otherwise `transient` → re-enqueue the *same* payload with
 *    `queueCycles + 1` and a `delaySeconds` backoff, so the consumer starts a
 *    fresh workflow instance later. The instance id changes with the cycle,
 *    so Workflows does not reject it as a duplicate.
 *
 * Every abandon path writes a terminal `failed` history row so the email
 * never disappears silently from the dashboard.
 */
export async function resolveSendEmailRunEnd(
  deps: RunEndDeps,
  data: SendEmailParams | undefined,
  failure: ClassifiableError,
): Promise<SendEmailRunOutcome> {
  const { emailRepository, sendEmailQueue } = deps;

  // --- Guard: unusable payload -------------------------------------------------
  if (!data?.emailId) {
    pinoLogger.error({ failure }, "Email run died: no emailId in the triggering payload");
    return { outcome: "abandoned", reason: "no emailId in payload" };
  }

  const cycles = data.queueCycles ?? 0;
  const friendly = friendlyErrorMessage(failure);

  // --- Stop 1: retry budget exhausted ------------------------------------------
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

  // --- Stop 2: error is permanent, retrying is pointless -----------------------
  if (classifyEmailError(failure) === "permanent") {
    pinoLogger.warn(
      { emailId: data.emailId, failure },
      "Email delivery abandoned: permanent failure",
    );
    await emailRepository?.saveEmailHistory(data.emailId, "failed", friendly, attemptOf(data));
    return { outcome: "abandoned", reason: "permanent failure" };
  }

  // --- Stop 3: no queue to retry through ---------------------------------------
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

  // --- Transient: bounce back onto the queue with a backoff --------------------
  const nextCycle = cycles + 1;
  const delaySeconds = backoffForCycle(cycles);

  try {
    await sendEmailQueue.send(
      { name: "app/send-email", data: { ...data, queueCycles: nextCycle } },
      { delaySeconds },
    );
  } catch (enqueueErr) {
    // If even the re-enqueue fails the email is stuck; record it and stop.
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
  // attempt-style row, not a terminal failure. If this write fails we still
  // return "requeued" — the retry itself already succeeded.
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
 * function). One instance = one queue message = one delivery attempt.
 *
 * ## Retry architecture (two independent systems)
 *
 * | Layer | Owner | Retries | Purpose |
 * |---|---|---|---|
 * | Queue → Workflow | queue consumer + `max_retries: 3` | 4 attempts | Transient *start* failures (Workflow API down, etc.) |
 * | SMTP attempt | this class, `retries: { limit: 0 }` | exactly 1 | No auto-retry: SMTP is not idempotent |
 * | Workflow → Queue | `resolveSendEmailRunEnd` queue cycles | up to 5 | Bounded retry ladder for *transient* SMTP errors |
 *
 * ## Step sequence (durable — each `step.do` checkpoint survives restarts)
 *
 * 1. `email-received-and-update-history` — mark the email as received
 * 2. `processing` — mark as processing
 * 3. `cleaning-html-input` — sanitize HTML, mark as cleaned
 * 4. `send-mail-via-nodemailer` — the actual SMTP send (no auto-retry!)
 * 5. `save-infos-in-db` — store the SMTP message id + duration
 *
 * ## Parity notes vs the Inngest version
 *
 * - One SMTP attempt per instance, same five sequential steps.
 * - The SMTP step passes `retries: { limit: 0 }`: Workflows auto-retries
 *   steps by default (5 retries), which would send duplicate emails on a
 *   lost ack and defeat one-attempt-per-run classification.
 * - Failures are classified in-process (try/catch) instead of `onFailure`.
 * - The Cloudflare Queue still owns the retry ladder via queue cycles
 *   (1min→1h backoff, capped at MAX_QUEUE_CYCLES).
 * - Dropped: `retries`/`timeouts.finish` (no Workflows equivalent of the 30s
 *   cancel window — nodemailer socket timeouts in SmtpEmailTransport remain
 *   the hang safety net) and the `send-email-timeout` companion function.
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

    // Fresh repository per run: the Workflow instance may outlive the isolate
    // that started it (durable execution), so we must not cache across runs.
    const emailRepository = new SendEmailRepository(createDatabase(env.makisend_db));

    try {
      // Fresh transport per event: credential edits apply immediately and each
      // tenant sends with its own SMTP account. Done *outside* any step.do so a
      // config error (missing SMTP row, bad credentials) fails fast into the
      // classifier below without checkpointing a doomed run.
      const transport = await resolveTransportFor(env, data.smtpConfigId ?? undefined);

      // --- Step 1: mark received ------------------------------------------------
      await step.do("email-received-and-update-history", async () => {
        pinoLogger.info({ receiver: data.to }, "Email sending request pending");
        await emailRepository.saveEmailHistory(emailId, "received");
      });

      // --- Step 2: mark processing ----------------------------------------------
      await step.do("processing", async () => {
        pinoLogger.info({ receiver: data.to }, "Step: processing started");
        await emailRepository.saveEmailHistory(emailId, "processing");
      });

      // --- Step 3: sanitize HTML -------------------------------------------------
      // Returns the cleaned HTML into the run's durable state: if this instance
      // is ever resumed after a crash, the next step reads it from the
      // checkpoint instead of re-running this callback.
      // Must be a primitive: returning an *object* from step.do makes the
      // Workflows runtime emit a false "code had hung" cancellation right
      // after the run (workerd#6925 / workers-sdk#14959).
      const cleanedHtml = await step.do("cleaning-html-input", async () => {
        pinoLogger.info({ receiver: data.to }, "Step: cleaning HTML input");
        const cleanedHtml = cleanHtml(data.html);
        pinoLogger.info({ receiver: data.to }, "Step: HTML cleaned");
        await emailRepository.saveEmailHistory(emailId, "cleaned");
        return cleanedHtml;
      });

      // --- Step 4: SMTP send (the one non-idempotent step) -----------------------
      // `retries: { limit: 0 }` is critical: Workflows would otherwise auto-retry
      // this step up to 5 times (default), which would (a) send duplicate
      // emails when the send succeeded but the ack was lost, and (b) never let
      // the outer catch classify the error for the queue-cycle ladder.
      // Two values must survive the checkpoint, so the step returns them as a
      // JSON string — object returns trigger the false "code had hung"
      // cancellation (see step 3) — and the run parses it back below.
      const sendReceipt = await step.do(
        "send-mail-via-nodemailer",
        {
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
            // outer catch can classify the error. The dashboard timeline shows
            // each attempt.
            const reason = err instanceof Error ? err.message : String(err);
            pinoLogger.error({ receiver: data.to, attempt: currentAttempt, err }, "Step: SMTP send failed");
            await emailRepository.saveEmailHistory(emailId, "attempt_failed", reason, currentAttempt);
            throw err;
          }

          const durationMs = Math.round(performance.now() - startTime);
          pinoLogger.info({ smtpId: messageId, durationMs }, "Step: email dispatched via SMTP");
          // Record which attempt succeeded so the timeline shows retries on success too.
          await emailRepository.saveEmailHistory(emailId, "sent", undefined, currentAttempt);
          return JSON.stringify({ messageId, durationMs });
        },
      );

      const { messageId, durationMs } = JSON.parse(sendReceipt) as {
        messageId: string;
        durationMs: number;
      };

      // --- Step 5: persist the delivery receipt -----------------------------------
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
      // Any throw above lands here. Convert to a plain shape the classifier
      // understands (it only reads `code` and `message`), then hand off to the
      // shared end-of-run resolver which decides: abandon or re-enqueue.
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
