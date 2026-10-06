import { pinoLogger } from "@/core/logger";
import { getInngestClient } from "@/inngest/client";
import type { SendEmailQueueMessage } from "@/send-email/send-email.types";

// Backoff: 5s * 2^attempts, capped at 5 minutes (10s, 20s, 40s, ...).
const BASE_RETRY_DELAY_SECONDS = 5;
const MAX_RETRY_DELAY_SECONDS = 300;

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
 * accepted by Inngest). After `max_retries` (wrangler.jsonc) the message is
 * moved to the dead-letter queue instead of being dropped.
 *
 * Retry system 2 (Inngest -> SMTP) stays owned by the `send-email` function
 * (`retries: 4`).
 */
export async function sendEmailQueueConsumer(
  batch: MessageBatch<SendEmailQueueMessage>,
): Promise<void> {
  const inngest = getInngestClient();

  for (const msg of batch.messages) {
    try {
      // `id` lets Inngest deduplicate the event if a redelivery ever slips through.
      await inngest.send({
        ...msg.body,
        id: msg.body.data.emailId,
      });
      msg.ack();
    } catch (err) {
      pinoLogger.error(
        { err, attempts: msg.attempts, emailId: msg.body.data.emailId },
        "Failed to forward send-email event to Inngest; scheduling retry",
      );
      msg.retry({ delaySeconds: backoffDelaySeconds(msg.attempts) });
    }
  }
}
