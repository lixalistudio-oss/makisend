import { pinoLogger } from "@/core/logger";
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
 * Cloudflare Queue consumer: starts a SendEmailWorkflow instance per message.
 *
 * This is retry system 1 (queue -> Workflow). Each message is individually
 * acknowledged or scheduled for redelivery so one failing message never causes
 * the whole batch to be reprocessed (which would duplicate instances already
 * accepted by Workflows). When the retry budget is exhausted the message goes
 * to the dead-letter queue AND a `failed` history row is written, so the email
 * never disappears silently.
 *
 * Retry system 2 (Workflow -> SMTP) is owned by the SendEmailWorkflow steps and
 * the queue-cycle ladder in `resolveSendEmailRunEnd`.
 */
export async function sendEmailQueueConsumer(
  batch: MessageBatch<SendEmailQueueMessage>,
  env: Bindings,
): Promise<void> {
  const repository = new SendEmailRepository(createDatabase(env.makisend_db));

  for (const msg of batch.messages) {
    try {
      // The instance id doubles as the idempotency key: Workflows rejects a
      // create with a duplicate id, so a redelivery that slips through cannot
      // start a second run. It must include the queue cycle — a message bounced
      // back by resolveSendEmailRunEnd carries the same emailId and must still
      // trigger a fresh instance.
      await env.SEND_EMAIL_WORKFLOW.create({
        id: `${msg.body.data.emailId}:${msg.body.data.queueCycles ?? 0}`,
        params: msg.body.data,
      });
      msg.ack();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      pinoLogger.error(
        { err, attempts: msg.attempts, emailId: msg.body.data.emailId },
        "Failed to start SendEmailWorkflow instance; scheduling retry",
      );

      // Last chance before the DLQ: record the failure so the dashboard can show it.
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

      msg.retry({ delaySeconds: backoffDelaySeconds(msg.attempts) });
    }
  }
}
