import type {
  WebhookDeliveryStatus,
  WebhookDisabledReason,
  WebhookEventType,
  WebhookFailureKind,
} from "./webhooks.constants";

/**
 * A webhook_endpoints row as the repository returns it. `url`, `secret` and `previousSecret`
 * are ENCRYPTED here: only the service decrypts, and only what it needs.
 */
export interface WebhookEndpointRecord {
  id: string;
  userId: string;
  url: string;
  secret: string;
  previousSecret: string | null;
  previousSecretExpiresAt: Date | null;
  enabled: boolean;
  disabledReason: WebhookDisabledReason | null;
  consecutiveFailures: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * What the service hands out for the management routes: the URL decrypted, and no secret at
 * all (not even encrypted), so a secret cannot reach a response by accident.
 */
export type WebhookEndpoint = Omit<WebhookEndpointRecord, "secret" | "previousSecret">;

/** A new endpoint, values already encrypted by the service. */
export interface WebhookEndpointInsert {
  url: string;
  secret: string;
}

/** Everything the system may change on an endpoint. Absent = unchanged, null = cleared. */
export interface WebhookEndpointUpdate {
  url?: string;
  secret?: string;
  previousSecret?: string | null;
  previousSecretExpiresAt?: Date | null;
  enabled?: boolean;
  disabledReason?: WebhookDisabledReason | null;
  consecutiveFailures?: number;
}

export interface WebhookDeliveryRecord {
  id: string;
  endpointId: string;
  emailId: string | null;
  eventType: WebhookEventType;
  failureKind: WebhookFailureKind | null;
  status: WebhookDeliveryStatus;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  lastAttemptAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
}

/** A promise to notify one endpoint about one email (inserted with ON CONFLICT DO NOTHING). */
export interface NewEmailDelivery {
  endpointId: string;
  emailId: string;
  eventType: "email.sent" | "email.failed";
  failureKind: WebhookFailureKind | null;
}

/** The result of an attempt, written before the queue message is acked or retried. */
export interface WebhookDeliveryUpdate {
  status?: WebhookDeliveryStatus;
  attempts?: number;
  lastStatusCode?: number | null;
  lastError?: string | null;
  lastAttemptAt?: Date | null;
  deliveredAt?: Date | null;
}

/** What the payload of an email event is rebuilt from. `to` is ENCRYPTED. */
export interface WebhookEmailSource {
  emailId: string;
  userId: string;
  to: string;
  subject: string;
  apiKeyId: string | null;
  smtpMessageId: string | null;
  source: "api" | "test";
  createdAt: string;
}

/** One email_histories row, oldest first. `error` may hold a raw transport message: filter it. */
export interface WebhookEmailHistoryRow {
  status: string;
  error: string | null;
  attempts: number | null;
  createdAt: string;
}

/** Body of a makisend-webhooks queue message: an id only, never a payload, URL or secret. */
export interface WebhookQueueMessage {
  deliveryId: string;
}

/** Position in the deliveries log: newest first, ties broken by id. */
export interface DeliveryCursor {
  createdAt: Date;
  id: string;
}

export interface ListDeliveriesFilter {
  status?: WebhookDeliveryStatus;
  limit: number;
  /** Return the deliveries strictly after this position. */
  after?: DeliveryCursor;
}

export interface IWebhookRepository {
  /** The user's endpoints, oldest first. */
  findEndpointsByUser(userId: string): Promise<WebhookEndpointRecord[]>;
  /** Scoped by user: someone else's endpoint is `null`, exactly like an unknown id. */
  findEndpoint(id: string, userId: string): Promise<WebhookEndpointRecord | null>;
  insertEndpoint(userId: string, values: WebhookEndpointInsert): Promise<WebhookEndpointRecord>;
  /** `null` when no endpoint of this user has this id. */
  updateEndpoint(id: string, userId: string, values: WebhookEndpointUpdate): Promise<WebhookEndpointRecord | null>;
  /** Deliveries go with it (ON DELETE CASCADE). Returns whether a row was deleted. */
  deleteEndpoint(id: string, userId: string): Promise<boolean>;
  listDeliveries(endpointId: string, filter: ListDeliveriesFilter): Promise<WebhookDeliveryRecord[]>;

  // --- Delivery pipeline (publisher, consumer, test route). Not scoped by user: callers are
  // internal, or have checked ownership of the endpoint first. ---

  /** Unscoped: for the consumer, which only has a delivery id. */
  findEndpointById(id: string): Promise<WebhookEndpointRecord | null>;
  findEnabledEndpointsByUser(userId: string): Promise<WebhookEndpointRecord[]>;
  /** ON CONFLICT (email_id, endpoint_id) DO NOTHING: replaying a publication adds nothing. */
  insertEmailDeliveries(rows: NewEmailDelivery[]): Promise<void>;
  findPendingDeliveriesForEmail(emailId: string): Promise<WebhookDeliveryRecord[]>;
  findDelivery(id: string): Promise<WebhookDeliveryRecord | null>;
  /** A `webhook.test` delivery, created pending before the attempt so the rate limit counts it. */
  insertTestDelivery(endpointId: string): Promise<WebhookDeliveryRecord>;
  updateDelivery(id: string, values: WebhookDeliveryUpdate): Promise<void>;
  /** Test events of an endpoint created since `since` (rate limit), oldest first. */
  findTestDeliveriesSince(endpointId: string, since: Date): Promise<WebhookDeliveryRecord[]>;
  /** Deliveries of an endpoint attempted since `since` (rate limit of the manual retry). */
  countAttemptsSince(endpointId: string, since: Date): Promise<number>;
  /** failed → pending with attempts 0, only if still failed. `null` when it was not failed. */
  resetFailedDelivery(id: string): Promise<WebhookDeliveryRecord | null>;
  /** A 2xx: the failure streak is over. */
  resetEndpointFailures(id: string): Promise<void>;
  /** An abandoned delivery: +1 to the streak, disables the endpoint at `threshold`. */
  recordEndpointFailure(id: string, threshold: number): Promise<{ consecutiveFailures: number; disabled: boolean }>;
  /** Marks failed the deliveries still pending since before `before` (lost queue message). */
  failStalePendingDeliveries(before: Date): Promise<number>;
  findEmailForWebhook(emailId: string): Promise<WebhookEmailSource | null>;
  findEmailHistories(emailId: string): Promise<WebhookEmailHistoryRow[]>;
}

// --- Public (API) representations ---

export interface PublicWebhookEndpoint {
  id: string;
  url: string;
  enabled: boolean;
  disabledReason: WebhookDisabledReason | null;
  /** End of the window in which the previous secret still signs; null outside a rotation. */
  rotationEndsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toPublicWebhookEndpoint(endpoint: WebhookEndpoint, now: Date = new Date()): PublicWebhookEndpoint {
  const rotationEnds = endpoint.previousSecretExpiresAt;
  return {
    id: endpoint.id,
    url: endpoint.url,
    enabled: endpoint.enabled,
    disabledReason: endpoint.disabledReason,
    rotationEndsAt: rotationEnds && rotationEnds.getTime() > now.getTime() ? rotationEnds.toISOString() : null,
    createdAt: endpoint.createdAt.toISOString(),
    updatedAt: endpoint.updatedAt.toISOString(),
  };
}

export interface PublicWebhookDelivery {
  id: string;
  eventType: WebhookEventType;
  emailId: string | null;
  status: WebhookDeliveryStatus;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  lastAttemptAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

export function toPublicWebhookDelivery(delivery: WebhookDeliveryRecord): PublicWebhookDelivery {
  return {
    id: delivery.id,
    eventType: delivery.eventType,
    emailId: delivery.emailId,
    status: delivery.status,
    attempts: delivery.attempts,
    lastStatusCode: delivery.lastStatusCode,
    lastError: delivery.lastError,
    lastAttemptAt: delivery.lastAttemptAt?.toISOString() ?? null,
    deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
    createdAt: delivery.createdAt.toISOString(),
  };
}
