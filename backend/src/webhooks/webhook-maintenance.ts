import { pinoLogger } from "@/core/logger";
import { createDatabase } from "@/db/connection";
import type { Bindings } from "@/index";
import { WEBHOOK_STALE_PENDING_MS } from "./webhooks.constants";
import { WebhookRepository } from "./webhooks.repository";

/**
 * Daily cron: a delivery still pending 48 h after its creation lost its queue message (DLQ after
 * a consumer crash loop, or a publication whose queue send failed). The retry schedule ends
 * after ~32 h, so nothing alive is this old: it is marked failed, visible in the log, and can be
 * retried by hand (POST /webhooks/:id/deliveries/:deliveryId/retry).
 */
export async function runWebhookSweep(env: Bindings, now: Date = new Date()): Promise<number> {
  try {
    const repository = new WebhookRepository(createDatabase(env.makisend_db));
    const failed = await repository.failStalePendingDeliveries(new Date(now.getTime() - WEBHOOK_STALE_PENDING_MS));
    if (failed > 0) pinoLogger.warn({ failed }, "webhook-sweep: stale pending deliveries marked failed");
    return failed;
  } catch (err) {
    pinoLogger.error({ error: err instanceof Error ? err.message : String(err) }, "webhook-sweep failed");
    return 0;
  }
}
