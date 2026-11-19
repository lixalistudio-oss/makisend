import { decrypt, type KeyMaterial } from "@/core/crypto";
import { APP_VERSION } from "@/core/version";
import { buildSignatureHeader } from "./webhook-signature";
import { WEBHOOK_MAX_RETRY_DELAY_SECONDS, WEBHOOK_TIMEOUT_MS } from "./webhooks.constants";
import type { WebhookEndpointRecord } from "./webhooks.types";

/**
 * One signed POST to a receiver, and what to do next. Used by the queue consumer AND by
 * POST /webhooks/:id/test, so a test behaves exactly like a real delivery.
 *
 * The receiver's response body is never read into memory, stored, logged or returned: only its
 * status. Redirects are never followed (`redirect: "manual"`): one could point inside the network.
 */

export const WEBHOOK_USER_AGENT = `MakiSend-Webhooks/${APP_VERSION}`;

/** delivered: 2xx. retry: worth trying later. failed: the receiver refused, retrying changes nothing. */
export type DeliveryVerdict = "delivered" | "retry" | "failed";

export interface DeliveryAttempt {
  verdict: DeliveryVerdict;
  /** HTTP status of the response, null when there was none (timeout, network). */
  statusCode: number | null;
  /** "timeout", "network error", "HTTP 500"… null on success. Never the response body. */
  error: string | null;
  durationMs: number;
  /** A 429's Retry-After, in seconds, capped at 12 h. */
  retryAfterSeconds: number | null;
}

export interface DeliverOnceInput {
  url: string;
  /** Plaintext `whsec_…` secrets, newest first: one signature each. */
  secrets: readonly string[];
  /** `msg_<delivery id>`: the same for every attempt of a delivery. */
  webhookId: string;
  /** The exact bytes signed and sent: serialized once by the caller. */
  body: string;
}

export interface DeliverOnceOptions {
  fetch?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}

/** Retryable statuses besides 5xx (Standard Webhooks / §6.6). */
const RETRYABLE_STATUSES = new Set([408, 409, 425, 429]);

export function classifyStatus(status: number): DeliveryVerdict {
  if (status >= 200 && status < 300) return "delivered";
  if (status >= 500 || RETRYABLE_STATUSES.has(status)) return "retry";
  return "failed"; // 3xx (not followed) and the other 4xx
}

/** `Retry-After` as seconds or an HTTP date. null when absent or unreadable. */
export function parseRetryAfter(value: string | null, now: Date): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  let seconds: number;
  if (/^\d+$/.test(trimmed)) {
    seconds = Number(trimmed);
  } else {
    const date = Date.parse(trimmed);
    if (Number.isNaN(date)) return null;
    seconds = Math.ceil((date - now.getTime()) / 1000);
  }
  return Math.min(Math.max(seconds, 0), WEBHOOK_MAX_RETRY_DELAY_SECONDS);
}

export async function deliverOnce(input: DeliverOnceInput, options: DeliverOnceOptions = {}): Promise<DeliveryAttempt> {
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const started = now();
  const timestamp = Math.floor(started.getTime() / 1000);
  const elapsed = () => Math.max(0, now().getTime() - started.getTime());

  const signature = await buildSignatureHeader(input.secrets, input.webhookId, timestamp, input.body);

  let response: Response;
  try {
    response = await fetchImpl(input.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": WEBHOOK_USER_AGENT,
        "webhook-id": input.webhookId,
        "webhook-timestamp": String(timestamp),
        "webhook-signature": signature,
      },
      body: input.body,
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs ?? WEBHOOK_TIMEOUT_MS),
    });
  } catch (err) {
    const name = (err as { name?: string })?.name;
    const timedOut = name === "TimeoutError" || name === "AbortError";
    return {
      verdict: "retry",
      statusCode: null,
      error: timedOut ? "timeout" : "network error",
      durationMs: elapsed(),
      retryAfterSeconds: null,
    };
  }

  // Free the connection without reading the body.
  try {
    await response.body?.cancel();
  } catch {
    // already closed
  }

  const verdict = classifyStatus(response.status);
  return {
    verdict,
    statusCode: response.status,
    error: verdict === "delivered" ? null : `HTTP ${response.status}`,
    durationMs: elapsed(),
    retryAfterSeconds: response.status === 429 ? parseRetryAfter(response.headers.get("retry-after"), now()) : null,
  };
}

/** The secrets that sign right now, decrypted, newest first: the previous one only within its window. */
export async function signingSecrets(
  endpoint: Pick<WebhookEndpointRecord, "secret" | "previousSecret" | "previousSecretExpiresAt">,
  aesKey: KeyMaterial,
  now: Date,
): Promise<string[]> {
  const secrets = [await decrypt(endpoint.secret, aesKey)];
  const expires = endpoint.previousSecretExpiresAt;
  if (endpoint.previousSecret && expires && expires.getTime() > now.getTime()) {
    secrets.push(await decrypt(endpoint.previousSecret, aesKey));
  }
  return secrets;
}

/** `webhook-id` header of a delivery. */
export const webhookIdFor = (deliveryId: string) => `msg_${deliveryId}`;
