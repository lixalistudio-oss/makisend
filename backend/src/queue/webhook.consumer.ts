import { resolveEncryptionKeys, resolveWebhookConfig } from "@/config/config";
import { pinoLogger } from "@/core/logger";
import { createDatabase } from "@/db/connection";
import type { Bindings } from "@/index";
import { WebhookRepository } from "@/webhooks/webhooks.repository";
import { processDelivery, type ProcessDeliveryDeps } from "@/webhooks/webhook-processor";
import type { WebhookQueueMessage } from "@/webhooks/webhooks.types";

/**
 * Consumer of makisend-webhooks: one signed POST per message ({ deliveryId }, nothing else).
 * Messages of a batch run in parallel, each with its own ack or retry, so one slow receiver
 * (up to 10 s) never holds the others. Dependencies are built from `env` here, like
 * sendEmailQueueConsumer: this entry point does not go through Hono or `deps`.
 *
 * An error thrown while processing (D1 unavailable…) retries the message with the queue's
 * retry_delay; past max_retries it lands in makisend-webhooks-dlq and the row stays pending
 * until the daily sweep marks it failed.
 */
export async function webhookQueueConsumer(
  batch: MessageBatch<WebhookQueueMessage>,
  env: Bindings,
  overrides: Partial<ProcessDeliveryDeps> = {},
): Promise<void> {
  const deps: ProcessDeliveryDeps = {
    repository: new WebhookRepository(createDatabase(env.makisend_db)),
    aesKey: resolveEncryptionKeys(env),
    urlOptions: resolveWebhookConfig(env),
    ...overrides,
  };

  await Promise.allSettled(
    batch.messages.map(async (msg) => {
      const deliveryId = msg.body?.deliveryId;
      if (typeof deliveryId !== "string" || deliveryId.length === 0) {
        pinoLogger.error("Discarding webhook queue message without a deliveryId");
        msg.ack();
        return;
      }
      try {
        const decision = await processDelivery(deliveryId, msg.attempts, deps);
        if (decision.action === "retry") msg.retry({ delaySeconds: decision.delaySeconds });
        else msg.ack();
      } catch (err) {
        pinoLogger.error(
          { deliveryId, attempts: msg.attempts, error: err instanceof Error ? err.message : String(err) },
          "Webhook delivery crashed; the queue will retry it",
        );
        msg.retry();
      }
    }),
  );
}

/** A batch of the webhooks queue, whatever its name (the Deploy button lets users rename queues). */
export function isWebhookBatch(batch: MessageBatch<unknown>): boolean {
  if (batch.queue.startsWith("makisend-webhooks")) return true;
  const body = batch.messages[0]?.body as { deliveryId?: unknown } | undefined;
  return typeof body?.deliveryId === "string";
}
