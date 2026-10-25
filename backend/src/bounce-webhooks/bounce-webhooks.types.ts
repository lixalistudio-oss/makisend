/** The SMTP providers whose delivery webhooks MakiSend reads. Same list as the DB enum (db/schema.ts). */
export const BOUNCE_WEBHOOK_PROVIDERS = ["resend", "sendgrid", "mailgun", "postmark"] as const;
export type BounceWebhookProviderId = (typeof BOUNCE_WEBHOOK_PROVIDERS)[number];

/**
 * What happened to a sent email, as MakiSend records it:
 * - delivered: the recipient's server accepted it.
 * - deferred: a temporary failure; the provider keeps trying.
 * - bounced: the provider gave up. `hard` when the address itself does not work.
 * - complained: the recipient marked it as spam.
 */
export type DeliveryEventKind = "delivered" | "deferred" | "bounced" | "complained";

/** One provider event, normalized. Never stored as is: it carries the recipient's address. */
export interface DeliveryEvent {
  /** The provider's id for this event: a retried webhook carries the same one. */
  eventKey: string;
  kind: DeliveryEventKind;
  /** Bounces only: the address does not exist or is disabled, so it is suppressed. */
  hard: boolean;
  /** The address the event concerns, when the provider sends it (Mailgun can redact it). */
  recipient: string | null;
  /** MakiSend's email id, read from the provider's echo of the tag added at send time. */
  emailId: string | null;
  /** The RFC Message-ID the provider reports, with or without angle brackets. */
  messageId: string | null;
  /** The provider's explanation (SMTP reply, bounce class). Shown in the logs. */
  reason: string;
}

/** The raw request, as received: signatures cover the exact bytes of the body. */
export interface WebhookRequest {
  header(name: string): string | undefined;
  rawBody: string;
}

export interface BounceWebhookProvider {
  id: BounceWebhookProviderId;
  /** Display name, used in the reasons stored with a log or a suppression. */
  label: string;
  /** Whether `secret` has the shape this provider issues. Checked when the owner saves it. */
  isValidSecret(secret: string): Promise<boolean>;
  /** Whether the request was signed by the provider with `secret`. Never throws. */
  verify(request: WebhookRequest, secret: string, now: Date): Promise<boolean>;
  /** The delivery events of a verified body. Events MakiSend does not track are left out. */
  parse(body: unknown, request: WebhookRequest): DeliveryEvent[];
  /**
   * Headers added at send time so the provider echoes MakiSend's email id in its events
   * (SendGrid unique_args, Mailgun user-variables, Postmark metadata). Empty when the
   * provider only reports the Message-ID.
   */
  correlationHeaders(emailId: string): Record<string, string>;
}

/** A configuration's webhook, as read for one request: the secret is decrypted. */
export interface BounceWebhookSettings {
  smtpConfigId: string;
  userId: string;
  provider: BounceWebhookProviderId;
  secret: string;
}

export interface NewDeliveryEventRow {
  smtpConfigId: string;
  provider: BounceWebhookProviderId;
  eventKey: string;
  kind: DeliveryEventKind;
  emailId: string | null;
}

export interface EventWrite {
  event: NewDeliveryEventRow;
  /** History row for the matched email; absent when the event matched none. */
  history?: { emailId: string; status: DeliveryEventKind; detail: string | null };
}

export interface IBounceWebhookRepository {
  /** Owner, provider and encrypted secret of a configuration, or null when it has no webhook. */
  findWebhook(smtpConfigId: string): Promise<{ userId: string; provider: BounceWebhookProviderId; secret: string } | null>;
  /** The keys among `eventKeys` already recorded for this configuration (provider retries). */
  findRecordedEventKeys(smtpConfigId: string, eventKeys: string[]): Promise<Set<string>>;
  /** Owner and encrypted recipient of each logged email among `emailIds`. */
  findEmails(emailIds: string[]): Promise<Map<string, { userId: string; to: string }>>;
  /** Records the events and appends their history rows. */
  saveEvents(writes: EventWrite[]): Promise<void>;
  /** Deletes events recorded before `before` (ISO date). Returns how many. */
  deleteEventsBefore(before: string): Promise<number>;
}

/** The one thing the webhook needs from the suppression list. */
export interface ISuppressionWriter {
  add(
    userId: string,
    email: string,
    entry: { source: "bounce" | "complaint"; reason: string; emailId?: string | null },
  ): Promise<boolean>;
}

/** What one webhook call did, for the logs and the tests. */
export interface WebhookReport {
  received: number;
  /** Events already recorded (a provider retry): skipped. */
  duplicates: number;
  /** Events tied to an email MakiSend sent. */
  matched: number;
  /** Addresses added to the suppression list. */
  suppressed: number;
}
