import { pinoLogger } from "@/core/logger";
import { createDatabase } from "@/db/connection";
import { SendEmailRepository } from "@/send-email/send-email.repository";
import type { Bindings } from "@/index";
import type { SendEmailQueueMessage } from "@/send-email/send-email.types";

// Backoff schedule for *consumer-level* retries (when `create()` itself throws,
// e.g. the Workflows API is briefly unavailable). Formula: 5s * 2^attempts,
// capped at 5 minutes → 10s, 20s, 40s, 80s, 160s, 300s, 300s, …
const BASE_RETRY_DELAY_SECONDS = 5;
const MAX_RETRY_DELAY_SECONDS = 300;
// Must match `max_retries` for the queue consumer in wrangler.jsonc: 1 initial
// delivery + 3 retries. The attempt that exhausts this budget moves to the DLQ,
// so that is the point where we persist a final failure for the dashboard.
const FINAL_ATTEMPT = 4;

/**
 * Exponential backoff for consumer retries, derived from the message's current
 * attempt count. `attempts` is 1-indexed (first delivery = 1).
 */
function backoffDelaySeconds(attempts: number): number {
  const delay = BASE_RETRY_DELAY_SECONDS * 2 ** Math.min(attempts, 10);
  return Math.min(delay, MAX_RETRY_DELAY_SECONDS);
}

/**
 * Cloudflare Queue consumer: starts one SendEmailWorkflow instance per message.
 *
 * ## Two independent retry systems
 *
 * **System 1 (this file): Queue → Workflow.** Covers failures to even *start*
 * a run (Workflows API down, invalid id, binding missing). Each message is
 * individually acked or retried so one bad message never re-delivers the whole
 * batch (which would duplicate instances already accepted by Workflows).
 * When the budget (`max_retries: 3`) is exhausted the message goes to the
 * dead-letter queue AND a `failed` history row is written — the email never
 * disappears silently.
 *
 * **System 2 (SendEmailWorkflow): Workflow → SMTP.** Covers failures *inside*
 * a run (SMTP errors). Owned by `resolveSendEmailRunEnd` and the queue-cycle
 * ladder; this consumer never sees those — it only sees fresh messages
 * (initial or re-enqueued with an incremented `queueCycles`).
 *
 * ## Instance id = idempotency key
 *
 * Format: `${emailId}-${queueCycles}` (e.g. `clxyz123-0`).
 *
 * - Workflows rejects a `create()` with a duplicate id, so a redelivery that
 *   slips through (e.g. ack lost after a successful create) cannot start a
 *   second run for the same email + cycle.
 * - The separator MUST be `-`, not `:` — Workflows instance ids only allow
 *   `[a-zA-Z0-9-_]` and must start with an alphanumeric. cuid2 emailIds are
 *   `[0-9a-z]` only, so `-` is unambiguous.
 * - A message re-enqueued by the workflow carries `queueCycles + 1`, so its
 *   id differs and a fresh instance starts as intended.
 */
export async function sendEmailQueueConsumer(
  batch: MessageBatch<SendEmailQueueMessage>,
  env: Bindings,
): Promise<void> {
  const repository = new SendEmailRepository(createDatabase(env.makisend_db));

  for (const msg of batch.messages) {
    try {
      await env.SEND_EMAIL_WORKFLOW.create({
        id: `${msg.body.data.emailId}-${msg.body.data.queueCycles ?? 0}`,
        params: msg.body.data,
      });
      // Only ack after create() succeeded: an early ack would drop the email
      // if the Worker crashed between ack and create.
      msg.ack();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      pinoLogger.error(
        { err, attempts: msg.attempts, emailId: msg.body.data.emailId },
        "Failed to start SendEmailWorkflow instance; scheduling retry",
      );

      // Last chance before the DLQ: record the failure so the dashboard can
      // show it. Without this the message would vanish into the DLQ with no
      // trace in the email timeline.
      if (msg.attempts >= FINAL_ATTEMPT) {
        try {
          await repository.saveEmailHistory(
            msg.body.data.emailId,
            "failed",
            `Failed to start workflow after ${msg.attempts} attempts: ${reason}`,
            msg.attempts,
          );
        } catch (historyErr) {
          pinoLogger.error(
            { err: historyErr, emailId: msg.body.data.emailId },
            "Failed to persist DLQ failure history",
          );
        }
      }

      // Explicit retry with our own backoff (Cloudflare also applies the
      // queue's `retry_delay`, but we pass delaySeconds for clarity and to
      // keep the schedule in one place).
      msg.retry({ delaySeconds: backoffDelaySeconds(msg.attempts) });
    }
  }
}
