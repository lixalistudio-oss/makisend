import { decrypt, type KeyMaterial } from "@/core/crypto";
import { pinoLogger } from "@/core/logger";
import { deliverOnce, signingSecrets, webhookIdFor, type DeliverOnceOptions } from "./webhook-delivery";
import { buildEmailPayload, buildTestPayload, type WebhookPayload } from "./webhook-payload";
import { parseWebhookUrl, type WebhookUrlOptions } from "./webhook-url";
import {
  WEBHOOK_AUTO_DISABLE_THRESHOLD,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_MAX_RETRY_DELAY_SECONDS,
  WEBHOOK_RETRY_DELAYS_SECONDS,
} from "./webhooks.constants";
import type { IWebhookRepository, WebhookDeliveryRecord } from "./webhooks.types";

/**
 * B2, delivery of one queue message (feat_webhooks_api_design.md §10.3). Pure decision logic,
 * free of the queue API: it returns what to do with the message, the consumer does it.
 *
 * Read before deciding, write before acking: the row is read again at every attempt (a
 * duplicate message finds it already done), and the outcome is written to D1 BEFORE the
 * message is acked or retried. A crash in between only replays an attempt; the receiver
 * dedupes on `webhook-id`, which is stable across attempts ("at least once").
 */

export type DeliveryDecision =
  | { action: "ack"; reason: string }
  | { action: "retry"; delaySeconds: number };

export interface ProcessDeliveryDeps {
  repository: IWebhookRepository;
  aesKey: KeyMaterial;
  urlOptions: WebhookUrlOptions;
  now?: () => Date;
  fetch?: DeliverOnceOptions["fetch"];
}

const ack = (reason: string): DeliveryDecision => ({ action: "ack", reason });

/** Delay before the attempt after `attemptNumber` (1-indexed); a 429's Retry-After wins, capped at 12 h. */
export function retryDelaySeconds(attemptNumber: number, retryAfterSeconds: number | null): number {
  const scheduled = WEBHOOK_RETRY_DELAYS_SECONDS[Math.min(attemptNumber, WEBHOOK_RETRY_DELAYS_SECONDS.length) - 1];
  const delay = retryAfterSeconds ?? scheduled;
  return Math.min(Math.max(delay, 0), WEBHOOK_MAX_RETRY_DELAY_SECONDS);
}

/**
 * @param queueAttempts the message's own attempt count (1 for the first delivery). The budget is
 *   spent when either it or the row's counter reaches WEBHOOK_MAX_ATTEMPTS, so a message is
 *   never retried past the queue's max_retries (it would land in the DLQ, still pending).
 */
export async function processDelivery(
  deliveryId: string,
  queueAttempts: number,
  deps: ProcessDeliveryDeps,
): Promise<DeliveryDecision> {
  const { repository } = deps;
  const now = deps.now ?? (() => new Date());

  const delivery = await repository.findDelivery(deliveryId);
  if (!delivery) return ack("delivery not found (endpoint deleted)");
  if (delivery.status !== "pending") return ack(`already ${delivery.status}`);

  const endpoint = await repository.findEndpointById(delivery.endpointId);
  if (!endpoint) return ack("endpoint not found");
  if (!endpoint.enabled) {
    await repository.updateDelivery(delivery.id, { status: "skipped", lastError: "endpoint disabled" });
    return ack("endpoint disabled");
  }

  // Revalidated at every attempt: the row may predate a stricter rule or a config change.
  const url = parseWebhookUrl(await decrypt(endpoint.url, deps.aesKey), deps.urlOptions);
  if (!url.ok) {
    await finishFailed(repository, delivery, { lastError: "url refused", lastAttemptAt: now() });
    return ack("url refused");
  }

  const payload = await buildPayload(repository, delivery, deps.aesKey, now());
  if (!payload) {
    await repository.updateDelivery(delivery.id, { status: "skipped", lastError: "email deleted" });
    return ack("email deleted");
  }

  const attemptedAt = now();
  const secrets = await signingSecrets(endpoint, deps.aesKey, attemptedAt);
  const attempt = await deliverOnce(
    { url: url.url, secrets, webhookId: webhookIdFor(delivery.id), body: JSON.stringify(payload) },
    { fetch: deps.fetch, now },
  );

  const attemptNumber = delivery.attempts + 1;
  const result = {
    attempts: attemptNumber,
    lastStatusCode: attempt.statusCode,
    lastError: attempt.error,
    lastAttemptAt: attemptedAt,
  };
  const log = { deliveryId, endpointId: endpoint.id, host: url.host, attempt: attemptNumber, status: attempt.statusCode };

  if (attempt.verdict === "delivered") {
    await repository.updateDelivery(delivery.id, { ...result, status: "delivered", deliveredAt: now() });
    await repository.resetEndpointFailures(endpoint.id);
    pinoLogger.info(log, "Webhook delivered");
    return ack("delivered");
  }

  const budgetLeft = attemptNumber < WEBHOOK_MAX_ATTEMPTS && queueAttempts < WEBHOOK_MAX_ATTEMPTS;
  if (attempt.verdict === "retry" && budgetLeft) {
    await repository.updateDelivery(delivery.id, result);
    const delaySeconds = retryDelaySeconds(attemptNumber, attempt.retryAfterSeconds);
    pinoLogger.warn({ ...log, error: attempt.error, delaySeconds }, "Webhook attempt failed; retrying later");
    return { action: "retry", delaySeconds };
  }

  const streak = await finishFailed(repository, delivery, result);
  pinoLogger.warn({ ...log, error: attempt.error, ...streak }, "Webhook delivery abandoned");
  return ack("failed");
}

/** An abandoned delivery: written failed, then counted against the endpoint (auto-disable). */
async function finishFailed(
  repository: IWebhookRepository,
  delivery: WebhookDeliveryRecord,
  values: Parameters<IWebhookRepository["updateDelivery"]>[1],
) {
  await repository.updateDelivery(delivery.id, { ...values, status: "failed" });
  // A test event never counts: it says nothing about real traffic.
  if (delivery.eventType === "webhook.test") return { consecutiveFailures: null, disabled: false };
  const streak = await repository.recordEndpointFailure(delivery.endpointId, WEBHOOK_AUTO_DISABLE_THRESHOLD);
  if (streak.disabled) {
    pinoLogger.warn({ endpointId: delivery.endpointId, ...streak }, "Webhook endpoint disabled after consecutive failures");
  }
  return streak;
}

/** The payload, rebuilt from D1 at each attempt. null when the email no longer exists. */
async function buildPayload(
  repository: IWebhookRepository,
  delivery: WebhookDeliveryRecord,
  aesKey: KeyMaterial,
  now: Date,
): Promise<WebhookPayload | null> {
  if (delivery.eventType === "webhook.test" || !delivery.emailId) {
    return buildTestPayload(delivery.endpointId, now);
  }
  const email = await repository.findEmailForWebhook(delivery.emailId);
  if (!email) return null;
  const histories = await repository.findEmailHistories(delivery.emailId);
  return buildEmailPayload(
    {
      eventType: delivery.eventType,
      failureKind: delivery.failureKind,
      email: { ...email, to: await decrypt(email.to, aesKey) },
      histories,
    },
    now,
  );
}

