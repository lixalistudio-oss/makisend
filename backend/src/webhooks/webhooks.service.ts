import { decrypt, encrypt, type KeyMaterial } from "@/core/crypto";
import { AppError } from "@/core/errors";
import { pinoLogger } from "@/core/logger";
import { deliverOnce, signingSecrets, webhookIdFor, type DeliverOnceOptions } from "./webhook-delivery";
import { buildTestPayload } from "./webhook-payload";
import { generateSecret } from "./webhook-signature";
import { parseWebhookUrl, webhookUrlHost, type WebhookUrlOptions } from "./webhook-url";
import {
  MAX_WEBHOOK_ENDPOINTS,
  WEBHOOK_ERROR_CODES,
  WEBHOOK_ROTATION_OVERLAP_MS,
  WEBHOOK_TEST_RATE_LIMIT,
  WEBHOOK_TEST_RATE_WINDOW_MS,
  type WebhookDeliveryStatus,
} from "./webhooks.constants";
import type {
  DeliveryCursor,
  IWebhookRepository,
  WebhookDeliveryRecord,
  WebhookEndpoint,
  WebhookEndpointRecord,
  WebhookEndpointUpdate,
  WebhookQueueMessage,
} from "./webhooks.types";

export interface WebhookEndpointWithSecret {
  endpoint: WebhookEndpoint;
  /** The plaintext secret. Returned on create and rotate only, never stored or logged in clear. */
  secret: string;
}

export interface DeliveriesPage {
  deliveries: WebhookDeliveryRecord[];
  nextCursor: string | null;
}

export interface ListDeliveriesInput {
  status?: WebhookDeliveryStatus;
  limit: number;
  cursor?: string;
}

/** Result of POST /webhooks/:id/test (api design §5.7): the receiver's body is never included. */
export interface WebhookTestResult {
  ok: boolean;
  statusCode: number | null;
  error: string | null;
  durationMs: number;
}

/** Over the limit of tests / manual retries: the controller answers 429 with Retry-After. */
export class WebhookRateLimitedError extends AppError {
  constructor(public readonly retryAfterSeconds: number) {
    super(429, "Too many test events. Try again in a minute.", WEBHOOK_ERROR_CODES.testRateLimited);
  }
}

export interface WebhooksServiceOptions {
  now?: () => Date;
  fetch?: DeliverOnceOptions["fetch"];
  /** Producer of makisend-webhooks, for the manual retry. */
  queue?: Queue<WebhookQueueMessage>;
}

const notFound = () => new AppError(404, "Webhook endpoint not found.", WEBHOOK_ERROR_CODES.notFound);

/**
 * Management of webhook endpoints (feat_webhooks_api_design.md §5, routes 1 to 6 and 8).
 * Knows nothing about Hono. Never logs a URL (it can carry a token) nor a secret: hosts and ids only.
 */
export class WebhooksService {
  constructor(
    private readonly repository: IWebhookRepository,
    private readonly aesKey: KeyMaterial,
    private readonly urlOptions: WebhookUrlOptions,
    private readonly options: WebhooksServiceOptions = {},
  ) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  async list(userId: string): Promise<WebhookEndpoint[]> {
    const records = await this.repository.findEndpointsByUser(userId);
    return Promise.all(records.map((record) => this.toEndpoint(record)));
  }

  async get(id: string, userId: string): Promise<WebhookEndpoint> {
    return this.toEndpoint(await this.findOrThrow(id, userId));
  }

  async create(userId: string, rawUrl: string): Promise<WebhookEndpointWithSecret> {
    const url = this.validateUrl(rawUrl);

    const existing = await this.repository.findEndpointsByUser(userId);
    if (existing.length >= MAX_WEBHOOK_ENDPOINTS) {
      throw new AppError(
        409,
        `You can register up to ${MAX_WEBHOOK_ENDPOINTS} webhook endpoints.`,
        WEBHOOK_ERROR_CODES.limitReached,
      );
    }
    await this.assertUrlIsFree(url, existing);

    const secret = generateSecret();
    const [encryptedUrl, encryptedSecret] = await Promise.all([
      encrypt(url, this.aesKey),
      encrypt(secret, this.aesKey),
    ]);
    const record = await this.repository.insertEndpoint(userId, { url: encryptedUrl, secret: encryptedSecret });

    pinoLogger.info({ userId, endpointId: record.id, host: webhookUrlHost(url) }, "Webhook endpoint created");
    return { endpoint: { ...withoutSecrets(record), url }, secret };
  }

  async update(
    id: string,
    userId: string,
    changes: { url?: string; enabled?: boolean },
  ): Promise<WebhookEndpoint> {
    await this.findOrThrow(id, userId);
    const values: WebhookEndpointUpdate = {};

    if (changes.url !== undefined) {
      const url = this.validateUrl(changes.url);
      const others = (await this.repository.findEndpointsByUser(userId)).filter((e) => e.id !== id);
      await this.assertUrlIsFree(url, others);
      values.url = await encrypt(url, this.aesKey);
    }

    if (changes.enabled === false) {
      values.enabled = false;
      values.disabledReason = "manual";
    } else if (changes.enabled === true) {
      // Re-enabling after an automatic disable starts the failure count over.
      values.enabled = true;
      values.disabledReason = null;
      values.consecutiveFailures = 0;
    }

    const updated = await this.repository.updateEndpoint(id, userId, values);
    if (!updated) throw notFound();
    pinoLogger.info({ userId, endpointId: id, enabled: updated.enabled }, "Webhook endpoint updated");
    return this.toEndpoint(updated);
  }

  async delete(id: string, userId: string): Promise<void> {
    const deleted = await this.repository.deleteEndpoint(id, userId);
    if (!deleted) throw notFound();
    pinoLogger.info({ userId, endpointId: id }, "Webhook endpoint deleted");
  }

  /**
   * New secret. The current one (already encrypted) moves to previous_secret and keeps signing
   * for 24 h, unless `expireCurrentNow` (a leaked secret). A second rotation within 24 h
   * replaces previous_secret: only the newest secret and the one before it stay valid.
   */
  async rotateSecret(
    id: string,
    userId: string,
    options: { expireCurrentNow?: boolean } = {},
  ): Promise<WebhookEndpointWithSecret> {
    const current = await this.findOrThrow(id, userId);
    const secret = generateSecret();
    const expireNow = options.expireCurrentNow === true;

    const updated = await this.repository.updateEndpoint(id, userId, {
      secret: await encrypt(secret, this.aesKey),
      previousSecret: expireNow ? null : current.secret,
      previousSecretExpiresAt: expireNow
        ? null
        : new Date(this.now().getTime() + WEBHOOK_ROTATION_OVERLAP_MS),
    });
    if (!updated) throw notFound();

    pinoLogger.info({ userId, endpointId: id, expireCurrentNow: expireNow }, "Webhook secret rotated");
    return { endpoint: await this.toEndpoint(updated), secret };
  }

  /** The deliveries log of one endpoint, newest first. Ownership is checked before reading it. */
  async listDeliveries(id: string, userId: string, input: ListDeliveriesInput): Promise<DeliveriesPage> {
    await this.findOrThrow(id, userId);
    const after = input.cursor === undefined ? undefined : decodeDeliveryCursor(input.cursor);

    // One extra row tells whether there is a next page.
    const rows = await this.repository.listDeliveries(id, {
      status: input.status,
      limit: input.limit + 1,
      after,
    });
    const deliveries = rows.slice(0, input.limit);
    const last = deliveries[deliveries.length - 1];
    return {
      deliveries,
      nextCursor: rows.length > input.limit && last ? encodeDeliveryCursor(last) : null,
    };
  }

  /**
   * Sends a `webhook.test` event right now, signed like a real one, and logs it. No queue, no
   * retry. Works on a disabled endpoint (useful before re-enabling it) and never touches its
   * failure streak. Limited to WEBHOOK_TEST_RATE_LIMIT per minute per endpoint: without it this
   * route would POST to any URL on demand.
   */
  async sendTest(id: string, userId: string): Promise<WebhookTestResult> {
    const endpoint = await this.findOrThrow(id, userId);
    const now = this.now();

    const recent = await this.repository.findTestDeliveriesSince(id, new Date(now.getTime() - WEBHOOK_TEST_RATE_WINDOW_MS));
    if (recent.length >= WEBHOOK_TEST_RATE_LIMIT) {
      const oldest = recent[0].createdAt.getTime();
      throw new WebhookRateLimitedError(Math.max(1, Math.ceil((oldest + WEBHOOK_TEST_RATE_WINDOW_MS - now.getTime()) / 1000)));
    }

    const url = this.validateUrl(await decrypt(endpoint.url, this.aesKey));
    // Logged pending first, so concurrent tests count against the limit.
    const delivery = await this.repository.insertTestDelivery(id);
    const body = JSON.stringify(buildTestPayload(id, now));
    const attempt = await deliverOnce(
      { url, secrets: await signingSecrets(endpoint, this.aesKey, now), webhookId: webhookIdFor(delivery.id), body },
      { fetch: this.options.fetch, now: () => this.now() },
    );

    const delivered = attempt.verdict === "delivered";
    await this.repository.updateDelivery(delivery.id, {
      status: delivered ? "delivered" : "failed",
      attempts: 1,
      lastStatusCode: attempt.statusCode,
      lastError: attempt.error,
      lastAttemptAt: now,
      deliveredAt: delivered ? this.now() : null,
    });
    pinoLogger.info(
      { userId, endpointId: id, host: webhookUrlHost(url), status: attempt.statusCode, ok: delivered },
      "Webhook test sent",
    );
    return { ok: delivered, statusCode: attempt.statusCode, error: attempt.error, durationMs: attempt.durationMs };
  }

  /**
   * Route 9: a failed delivery goes back to pending (attempts 0) and into the queue. Ownership
   * is checked along the chain delivery → endpoint → user. Same rate limit as the test route,
   * counted on the endpoint's recent attempts.
   */
  async retryDelivery(id: string, deliveryId: string, userId: string): Promise<WebhookDeliveryRecord> {
    await this.findOrThrow(id, userId);
    const delivery = await this.repository.findDelivery(deliveryId);
    if (!delivery || delivery.endpointId !== id) {
      throw new AppError(404, "Delivery not found.", WEBHOOK_ERROR_CODES.deliveryNotFound);
    }
    if (delivery.status !== "failed") {
      throw new AppError(409, "Only failed deliveries can be retried.", WEBHOOK_ERROR_CODES.deliveryNotFailed);
    }
    const now = this.now();
    const recentAttempts = await this.repository.countAttemptsSince(id, new Date(now.getTime() - WEBHOOK_TEST_RATE_WINDOW_MS));
    if (recentAttempts >= WEBHOOK_TEST_RATE_LIMIT) {
      throw new WebhookRateLimitedError(Math.ceil(WEBHOOK_TEST_RATE_WINDOW_MS / 1000));
    }
    if (!this.options.queue) throw new AppError(500, "The webhooks queue is not configured.");

    const reset = await this.repository.resetFailedDelivery(deliveryId);
    if (!reset) {
      throw new AppError(409, "Only failed deliveries can be retried.", WEBHOOK_ERROR_CODES.deliveryNotFailed);
    }
    try {
      await this.options.queue.send({ deliveryId });
    } catch (err) {
      // Not queued: put it back so the log does not show a pending delivery nothing will send.
      await this.repository.updateDelivery(deliveryId, { status: "failed" });
      throw err;
    }
    pinoLogger.info({ userId, endpointId: id, deliveryId }, "Webhook delivery queued again by hand");
    return reset;
  }

  private validateUrl(rawUrl: string): string {
    const result = parseWebhookUrl(rawUrl, this.urlOptions);
    if (!result.ok) throw new AppError(400, result.message, WEBHOOK_ERROR_CODES.urlInvalid);
    return result.url;
  }

  /** URLs are encrypted with a random IV, so uniqueness is checked here, on the decrypted values. */
  private async assertUrlIsFree(url: string, endpoints: WebhookEndpointRecord[]): Promise<void> {
    const urls = await Promise.all(endpoints.map((e) => decrypt(e.url, this.aesKey)));
    if (urls.includes(url)) {
      throw new AppError(409, "This URL is already registered.", WEBHOOK_ERROR_CODES.urlExists);
    }
  }

  private async findOrThrow(id: string, userId: string): Promise<WebhookEndpointRecord> {
    const record = await this.repository.findEndpoint(id, userId);
    if (!record) throw notFound();
    return record;
  }

  private async toEndpoint(record: WebhookEndpointRecord): Promise<WebhookEndpoint> {
    return { ...withoutSecrets(record), url: await decrypt(record.url, this.aesKey) };
  }
}

function withoutSecrets(record: WebhookEndpointRecord): WebhookEndpoint {
  const { secret: _secret, previousSecret: _previousSecret, ...endpoint } = record;
  return endpoint;
}

/** Opaque to clients: base64 of `<created_at ms>|<id>`. */
export function encodeDeliveryCursor(position: { createdAt: Date; id: string }): string {
  return btoa(`${position.createdAt.getTime()}|${position.id}`);
}

export function decodeDeliveryCursor(cursor: string): DeliveryCursor {
  const invalid = () => new AppError(400, "Invalid cursor.", WEBHOOK_ERROR_CODES.cursorInvalid);
  let decoded: string;
  try {
    decoded = atob(cursor);
  } catch {
    throw invalid();
  }
  const match = /^(\d{1,15})\|([A-Za-z0-9_-]{1,128})$/.exec(decoded);
  if (!match) throw invalid();
  return { createdAt: new Date(Number(match[1])), id: match[2] };
}
