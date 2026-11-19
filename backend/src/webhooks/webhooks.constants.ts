/**
 * Limits of the webhooks feature (feat_webhooks_api_design.md §8).
 * MAX_WEBHOOK_ENDPOINTS is repeated in frontend/src/components/webhooks-layout.tsx: keep both equal.
 */
export const MAX_WEBHOOK_ENDPOINTS = 5;
export const MAX_WEBHOOK_URL_LENGTH = 2048;

/** Bytes of randomness in a signing secret, before base64. */
export const WEBHOOK_SECRET_BYTES = 32;
export const WEBHOOK_SECRET_PREFIX = "whsec_";

/** How long the previous secret keeps signing after a rotation. */
export const WEBHOOK_ROTATION_OVERLAP_MS = 24 * 60 * 60 * 1000;

export const WEBHOOK_DELIVERIES_DEFAULT_LIMIT = 20;
export const WEBHOOK_DELIVERIES_MAX_LIMIT = 100;

export const WEBHOOK_EVENT_TYPES = ["email.sent", "email.failed", "webhook.test"] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export const WEBHOOK_DELIVERY_STATUSES = ["pending", "delivered", "failed", "skipped"] as const;
export type WebhookDeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUSES)[number];

export const WEBHOOK_DISABLED_REASONS = ["manual", "auto"] as const;
export type WebhookDisabledReason = (typeof WEBHOOK_DISABLED_REASONS)[number];

export const WEBHOOK_FAILURE_KINDS = ["permanent", "transient_exhausted", "config", "internal"] as const;
/** Why an email ended `failed` (payload `failureKind`). */
export type WebhookFailureKind = (typeof WEBHOOK_FAILURE_KINDS)[number];

/** Final status of an email, the only two that publish a webhook. */
export type FinalEmailStatus = "sent" | "failed";

// --- Delivery (feat_webhooks_api_design.md §6.6) ---

/** Time a receiver has to answer before the attempt counts as a timeout. */
export const WEBHOOK_TIMEOUT_MS = 10_000;
/** Delay before attempts 2 to 8: about 32 h in all, within the queue's 4-day retention. */
export const WEBHOOK_RETRY_DELAYS_SECONDS = [60, 300, 1800, 7200, 21600, 43200, 43200] as const;
/** Attempts per delivery. `max_retries` of the makisend-webhooks consumer (wrangler.jsonc) = this - 1. */
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_DELAYS_SECONDS.length + 1;
/** Cloudflare Queues caps a retry delay at 12 h; a longer Retry-After is clamped to it. */
export const WEBHOOK_MAX_RETRY_DELAY_SECONDS = 43_200;
/** Abandoned deliveries in a row before the endpoint is disabled (`disabledReason: "auto"`). */
export const WEBHOOK_AUTO_DISABLE_THRESHOLD = 20;
/** Entries of `history` kept in the payload (the most recent ones). */
export const WEBHOOK_HISTORY_MAX_ENTRIES = 20;
/** POST /webhooks/:id/test (and the manual retry): calls per endpoint per window. */
export const WEBHOOK_TEST_RATE_LIMIT = 5;
export const WEBHOOK_TEST_RATE_WINDOW_MS = 60_000;
/** A delivery still pending after this long is marked failed by the daily cron (lost message). */
export const WEBHOOK_STALE_PENDING_MS = 48 * 60 * 60 * 1000;

/** Stable `code` values of the AppErrors thrown by this module (api design §7). */
export const WEBHOOK_ERROR_CODES = {
  urlInvalid: "WEBHOOK_URL_INVALID",
  notFound: "WEBHOOK_NOT_FOUND",
  limitReached: "WEBHOOK_LIMIT_REACHED",
  urlExists: "WEBHOOK_URL_EXISTS",
  cursorInvalid: "WEBHOOK_CURSOR_INVALID",
  testRateLimited: "WEBHOOK_TEST_RATE_LIMITED",
  deliveryNotFound: "WEBHOOK_DELIVERY_NOT_FOUND",
  deliveryNotFailed: "WEBHOOK_DELIVERY_NOT_FAILED",
} as const;
