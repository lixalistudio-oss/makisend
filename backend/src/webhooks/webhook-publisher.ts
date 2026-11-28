import { pinoLogger } from "@/core/logger";
import type { FinalEmailStatus, WebhookFailureKind } from "./webhooks.constants";
import type { IWebhookRepository, WebhookQueueMessage } from "./webhooks.types";

/**
 * B1, publication (feat_webhooks_api_design.md §10.2): called once an email's final status is
 * WRITTEN in D1. Never contacts a receiver.
 *
 * Outbox: the promises (webhook_deliveries rows) are written first, then the pending ones of
 * THIS email are read back and put in the queue. Replayed after a crash anywhere in between, it
 * inserts nothing new (unique (email_id, endpoint_id)) and re-sends the still-pending ids: a
 * duplicate message is harmless (the consumer reads the row first), a missing row would be a
 * lost notification. Sending before inserting is the one order that can lose one.
 */
export class WebhookPublisher {
  constructor(
    private readonly repository: IWebhookRepository,
    private readonly queue: Queue<WebhookQueueMessage> | undefined,
  ) {}

  /**
   * Cheap check run inside the Workflow's bookkeeping step, so an email whose owner has no
   * enabled endpoint costs no extra Workflow step (the step quota is the tightest limit).
   */
  async hasEnabledEndpoints(emailId: string): Promise<boolean> {
    const email = await this.repository.findEmailForWebhook(emailId);
    if (!email || email.source === "test") return false;
    return (await this.repository.findEnabledEndpointsByUser(email.userId)).length > 0;
  }

  /** Returns how many deliveries were put in the queue (a number: Workflow steps return primitives). */
  async publishFinalStatus(
    emailId: string,
    status: FinalEmailStatus,
    failureKind: WebhookFailureKind | null = null,
  ): Promise<number> {
    const email = await this.repository.findEmailForWebhook(emailId);
    // Dashboard test sends show their result on screen: no webhook (api design §6.2).
    if (!email || email.source === "test") return 0;

    const endpoints = await this.repository.findEnabledEndpointsByUser(email.userId);
    if (endpoints.length === 0) return 0;

    const eventType = status === "sent" ? "email.sent" : "email.failed";
    await this.repository.insertEmailDeliveries(
      endpoints.map((endpoint) => ({
        endpointId: endpoint.id,
        emailId,
        eventType,
        failureKind: status === "failed" ? (failureKind ?? "internal") : null,
      })),
    );

    const pending = await this.repository.findPendingDeliveriesForEmail(emailId);
    if (pending.length === 0) return 0;
    if (!this.queue) {
      // The rows stay pending; the daily sweep marks them failed after 48 h.
      throw new Error("WEBHOOK_QUEUE binding is missing: webhook deliveries cannot be queued");
    }

    // sendBatch takes up to 100 messages; MAX_WEBHOOK_ENDPOINTS keeps us far below.
    await this.queue.sendBatch(pending.map((delivery) => ({ body: { deliveryId: delivery.id } })));
    pinoLogger.info({ emailId, status, deliveries: pending.length }, "Webhook deliveries queued");
    return pending.length;
  }
}
