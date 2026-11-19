import { friendlyErrorMessage } from "@/send-email/error-classifier";
import {
  WEBHOOK_HISTORY_MAX_ENTRIES,
  type FinalEmailStatus,
  type WebhookFailureKind,
} from "./webhooks.constants";
import type { WebhookEmailHistoryRow } from "./webhooks.types";

/**
 * The public webhook contract (feat_webhooks_api_design.md §6). Fields can be ADDED later, never
 * removed or renamed: receivers have integrated this shape.
 *
 * Never sent: bodies, attachments, SMTP host or credentials, the API key itself, raw transport
 * errors, stack traces. Reasons go through toPublicReason().
 */

export interface WebhookHistoryEntry {
  status: string;
  attempt: number | null;
  at: string;
  reason: string | null;
}

export interface EmailWebhookData {
  emailId: string;
  status: FinalEmailStatus;
  to: string;
  subject: string;
  apiKeyId: string | null;
  smtpMessageId: string | null;
  attempts: number;
  failureKind?: WebhookFailureKind;
  reason?: string;
  createdAt: string;
  completedAt: string;
  history: WebhookHistoryEntry[];
}

export interface EmailWebhookPayload {
  type: "email.sent" | "email.failed";
  timestamp: string;
  data: EmailWebhookData;
}

export interface TestWebhookPayload {
  type: "webhook.test";
  timestamp: string;
  data: { endpointId: string; message: string };
}

export type WebhookPayload = EmailWebhookPayload | TestWebhookPayload;

export const TEST_EVENT_MESSAGE = "Test event from MakiSend";
const INTERNAL_FAILURE_REASON = "MakiSend could not process this email. Please try sending it again.";

export function buildTestPayload(endpointId: string, now: Date): TestWebhookPayload {
  return { type: "webhook.test", timestamp: now.toISOString(), data: { endpointId, message: TEST_EVENT_MESSAGE } };
}

/** Statuses of email_histories that are worth a line in `history`. */
const HISTORY_STATUSES = new Set(["received", "processing", "cleaned", "attempt_failed", "sent", "failed"]);

/**
 * A reason that can leave MakiSend. `attempt_failed` rows hold the raw nodemailer message for a
 * transient error (it can name a host, an IP or the server's reply): it is replaced by the
 * classifier's generic sentence. `failed` rows are written by MakiSend from already friendly
 * text, except when the workflow never started (`internal`), whose text comes from the platform.
 */
export function toPublicReason(
  status: string,
  error: string | null,
  failureKind: WebhookFailureKind | null,
): string | null {
  if (!error) return null;
  if (status === "attempt_failed") return friendlyErrorMessage({ message: error });
  if (status === "failed") return failureKind === "internal" ? INTERNAL_FAILURE_REASON : error;
  return null;
}

export interface EmailPayloadInput {
  eventType: "email.sent" | "email.failed";
  failureKind: WebhookFailureKind | null;
  email: {
    emailId: string;
    to: string;
    subject: string;
    apiKeyId: string | null;
    smtpMessageId: string | null;
    createdAt: string;
  };
  histories: WebhookEmailHistoryRow[];
}

/** `email.sent` / `email.failed`, rebuilt from email_logs + email_histories (oldest first). */
export function buildEmailPayload(input: EmailPayloadInput, now: Date): EmailWebhookPayload {
  const status: FinalEmailStatus = input.eventType === "email.sent" ? "sent" : "failed";
  const failureKind = status === "failed" ? (input.failureKind ?? "internal") : null;
  const rows = input.histories.filter((row) => HISTORY_STATUSES.has(row.status));

  const final = [...rows].reverse().find((row) => row.status === status);
  const attempts = Math.max(
    0,
    final?.attempts ?? 0,
    ...rows.map((row) => row.attempts ?? 0),
  );

  const history = rows.slice(-WEBHOOK_HISTORY_MAX_ENTRIES).map((row) => ({
    status: row.status,
    attempt: row.attempts,
    at: toIso(row.createdAt),
    reason: toPublicReason(row.status, row.error, failureKind),
  }));

  // Key order follows the documented payload (§6.3, §6.4).
  const data: EmailWebhookData = {
    emailId: input.email.emailId,
    status,
    to: input.email.to,
    subject: input.email.subject,
    apiKeyId: input.email.apiKeyId,
    smtpMessageId: status === "sent" ? input.email.smtpMessageId : null,
    attempts,
    ...(status === "failed"
      ? {
          failureKind: failureKind!,
          reason: toPublicReason("failed", final?.error ?? null, failureKind) ?? INTERNAL_FAILURE_REASON,
        }
      : {}),
    createdAt: toIso(input.email.createdAt),
    completedAt: toIso(final?.createdAt ?? now.toISOString()),
    history,
  };

  return { type: input.eventType, timestamp: now.toISOString(), data };
}

function toIso(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}
