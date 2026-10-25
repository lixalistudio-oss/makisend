import { pinoLogger } from "@/core/logger";
import { createDatabase } from "@/db/connection";
import { BounceWebhookRepository } from "./bounce-webhooks.repository";
import { EVENT_RETENTION_DAYS } from "./bounce-webhooks.service";
import type { Bindings } from "@/index";

/** Daily cron: forgets delivery events older than the retention window (dedupe only needs recent ones). */
export async function runDeliveryEventsPrune(env: Bindings, now: Date = new Date()): Promise<number> {
  const before = new Date(now.getTime() - EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const deleted = await new BounceWebhookRepository(createDatabase(env.makisend_db)).deleteEventsBefore(before);
  pinoLogger.info({ deleted, before }, "Delivery events pruned");
  return deleted;
}
