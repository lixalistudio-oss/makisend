import { pinoLogger } from "@/core/logger";
import { getInngestClient } from "@/inngest/client";
import { createDatabase } from "@/db/connection";
import { SendEmailRepository } from "@/send-email/send-email.repository";
import type { Bindings } from "@/index";
import type { SendEmailQueueMessage } from "@/send-email/send-email.types";

// Backoff: 5s * 2^attempts, capped at 5 minutes (10s, 20s, 40s, ...).
const BASE_RETRY_DELAY_SECONDS = 5;
const MAX_RETRY_DELAY_SECONDS = 300;
// Must match `max_retries` for the queue consumer in wrangler.jsonc: 1 initial
// delivery + 3 retries. The attempt that exhausts this budget moves to the DLQ,
// so that is the point where we persist a final failure for the dashboard.
const FINAL_ATTEMPT = 4;

function backoffDelaySeconds(attempts: number): number {
  const delay = BASE_RETRY_DELAY_SECONDS * 2 ** Math.min(attempts, 10);
  return Math.min(delay, MAX_RETRY_DELAY_SECONDS);
}

/**
 * Cloudflare Queue consumer: forwards buffered HTTP requests to Inngest.
 *
 * This is retry system 1 (queue -> Inngest). Each message is individually
 * acknowledged or scheduled for redelivery so one failing message never causes
 * the whole batch to be reprocessed (which would duplicate events already
 * accepted by Inngest). When the retry budget is exhausted the message goes to
 * the dead-letter queue AND a `failed` history row is written, so the email
 * never disappears silently.
 *
 * Retry system 2 (Inngest -> SMTP) stays owned by the `send-email` function
 * (`retries: 4`).
 */
export async function sendEmailQueueConsumer(
  batch: MessageBatch<SendEmailQueueMessage>,
  env: Bindings,
): Promise<void> {
  const inngest = getInngestClient();
  const repository = new SendEmailRepository(createDatabase(env.makisend_db));

  for (const msg of batch.messages) {
    try {
      // `id` lets Inngest deduplicate the event if a redelivery ever slips
      // through. It is also an idempotency key for 24h, so it must include the
      // queue cycle: a message bounced back by `onFailure` carries the same
      // emailId and must still trigger a fresh run.
      await inngest.send({
        ...msg.body,
        id: `${msg.body.data.emailId}:${msg.body.data.queueCycles ?? 0}`,
      });
      msg.ack();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      pinoLogger.error(
        { err, attempts: msg.attempts, emailId: msg.body.data.emailId },
        "Failed to forward send-email event to Inngest; scheduling retry",
      );

      // Last chance before the DLQ: record the failure so the dashboard can show it.
      if (msg.attempts >= FINAL_ATTEMPT) {
        try {
          await repository.saveEmailHistory(
            msg.body.data.emailId,
            "failed",
            `Failed to deliver to Inngest after ${msg.attempts} attempts: ${reason}`,
            msg.attempts,
          );
        } catch (historyErr) {
          pinoLogger.error(
            { err: historyErr, emailId: msg.body.data.emailId },
            "Failed to persist DLQ failure history",
          );
        }
      }

      msg.retry({ delaySeconds: backoffDelaySeconds(msg.attempts) });
    }
  }
}
