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
 * The queue payload only carries `{ emailId }`, so both the queue message and
 * the workflow state are free of PII. Retries inside a run are owned by the
 * workflow (3 retries, 30s apart); this consumer only retries failures to
 * *start* a run (Workflows API unavailable, etc.).
 *
 * Instance id = emailId. Workflows rejects a duplicate `create()`, so a
 * redelivery after a lost ack cannot start a second run for the same email.
 * On a duplicate we check `get(emailId)` and ack: the original run is alive.
 */
export async function sendEmailQueueConsumer(
  batch: MessageBatch<SendEmailQueueMessage>,
  env: Bindings,
): Promise<void> {
  const repository = new SendEmailRepository(createDatabase(env.makisend_db));

  for (const msg of batch.messages) {
    const emailId = msg.body?.emailId;

    if (!emailId) {
      pinoLogger.error({ body: msg.body }, "Discarding queue message without an emailId");
      msg.ack();
      continue;
    }

    try {
      await env.SEND_EMAIL_WORKFLOW.create({
        id: emailId,
        params: { emailId },
      });
      // Only ack after create() succeeded: an early ack would drop the email
      // if the Worker crashed between ack and create.
      msg.ack();
    } catch (err) {
      // Duplicate instance id means a previous delivery already started the
      // run; ack it instead of retrying forever.
      try {
        const existing = await env.SEND_EMAIL_WORKFLOW.get(emailId);
        if (existing) {
          pinoLogger.info({ emailId }, "SendEmailWorkflow already started; acking duplicate");
          msg.ack();
          continue;
        }
      } catch (getErr) {
        pinoLogger.error(
          { err: getErr, emailId },
          "Failed to check for an existing SendEmailWorkflow instance",
        );
      }

      const reason = err instanceof Error ? err.message : String(err);
      pinoLogger.error(
        { err, attempts: msg.attempts, emailId },
        "Failed to start SendEmailWorkflow instance; scheduling retry",
      );

      // Last chance before the DLQ: record the failure so the dashboard can
      // show it. Without this the message would vanish into the DLQ with no
      // trace in the email timeline.
      if (msg.attempts >= FINAL_ATTEMPT) {
        try {
          await repository.saveEmailHistory(
            emailId,
            "failed",
            `Failed to start workflow after ${msg.attempts} attempts: ${reason}`,
            msg.attempts,
          );
        } catch (historyErr) {
          pinoLogger.error(
            { err: historyErr, emailId },
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
