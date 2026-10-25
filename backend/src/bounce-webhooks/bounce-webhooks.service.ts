import { decrypt, type KeyMaterial } from "@/core/crypto";
import { AppError } from "@/core/errors";
import { pinoLogger } from "@/core/logger";
import type {
  BounceWebhookProvider,
  DeliveryEvent,
  EventWrite,
  IBounceWebhookRepository,
  ISuppressionWriter,
  WebhookReport,
  WebhookRequest,
} from "./bounce-webhooks.types";
import { emailIdFromMessageId } from "./correlation";
import { providerFor } from "./providers";

/** A provider batch larger than this is refused (SendGrid batches by size; D1 caps queries per call). */
export const MAX_EVENTS_PER_REQUEST = 1000;
/** delivery_events rows are kept this long (bounce-webhooks.cron.ts): provider retries stop well before. */
export const EVENT_RETENTION_DAYS = 30;

const normalize = (address: string) => address.trim().toLowerCase();

/** The same answer for an unknown configuration, one without webhook and a bad signature. */
const unauthorized = () => new AppError(401, "Invalid webhook signature");

function describe(event: DeliveryEvent, provider: BounceWebhookProvider): string | null {
  const detail = event.reason ? ` (${event.reason})` : "";
  const by = ` reported by ${provider.label}`;
  switch (event.kind) {
    case "delivered":
      return null;
    case "deferred":
      return `Delivery delayed${by}${detail}`;
    case "complained":
      return `Spam complaint${by}${detail}`;
    case "bounced":
      return `${event.hard ? "Hard bounce" : "Bounce"}${by}${detail}`;
  }
}

function suppressionSource(event: DeliveryEvent): "bounce" | "complaint" | null {
  if (event.kind === "complained") return "complaint";
  if (event.kind === "bounced" && event.hard) return "bounce";
  return null;
}

/**
 * Applies a provider's delivery events to MakiSend: each is checked against the configuration's
 * secret, recorded once, appended to the history of the email it concerns (when it can be tied
 * to one the configuration's owner sent) and, for a hard bounce or a spam complaint, adds the
 * address to the owner's suppression list.
 */
export class BounceWebhookService {
  constructor(
    private readonly repository: IBounceWebhookRepository,
    private readonly suppressions: ISuppressionWriter,
    private readonly keys: KeyMaterial,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async handle(smtpConfigId: string, request: WebhookRequest): Promise<WebhookReport> {
    const webhook = await this.repository.findWebhook(smtpConfigId);
    if (!webhook) throw unauthorized();

    let secret: string;
    try {
      secret = await decrypt(webhook.secret, this.keys);
    } catch (err) {
      pinoLogger.error({ err, smtpConfigId }, "Bounce webhook secret could not be decrypted");
      throw new AppError(500, "The webhook secret could not be read");
    }

    const provider = providerFor(webhook.provider);
    if (!(await provider.verify(request, secret, this.now()))) {
      pinoLogger.warn({ smtpConfigId, provider: provider.id }, "Bounce webhook refused: bad signature");
      throw unauthorized();
    }

    let body: unknown;
    try {
      body = JSON.parse(request.rawBody);
    } catch {
      throw new AppError(400, "The webhook body is not JSON");
    }

    const events = provider.parse(body, request);
    if (events.length > MAX_EVENTS_PER_REQUEST) {
      throw new AppError(413, `At most ${MAX_EVENTS_PER_REQUEST} events per request`);
    }

    const report: WebhookReport = { received: events.length, duplicates: 0, matched: 0, suppressed: 0 };
    if (events.length === 0) return report;

    const recorded = await this.repository.findRecordedEventKeys(
      smtpConfigId,
      events.map((event) => event.eventKey),
    );
    const fresh = events.filter((event) => !recorded.has(event.eventKey));
    report.duplicates = events.length - fresh.length;

    const candidates = new Map<DeliveryEvent, string>();
    for (const event of fresh) {
      const emailId = event.emailId ?? emailIdFromMessageId(event.messageId);
      if (emailId) candidates.set(event, emailId);
    }
    const emails = await this.repository.findEmails([...candidates.values()]);

    const writes: EventWrite[] = [];
    for (const event of fresh) {
      const emailId = candidates.get(event);
      const email = emailId ? emails.get(emailId) : undefined;
      let matchedId: string | null = null;
      let recipient = event.recipient;

      // An event only touches an email the configuration's owner sent, to the address it names.
      if (emailId && email && email.userId === webhook.userId) {
        const to = await this.decryptRecipient(email.to, emailId);
        if (to && (!recipient || normalize(recipient) === normalize(to))) {
          matchedId = emailId;
          recipient ??= to;
        }
      }

      const detail = describe(event, provider);
      const source = suppressionSource(event);
      if (source && recipient) {
        const added = await this.suppressions.add(webhook.userId, recipient, {
          source,
          reason: detail ?? `Reported by ${provider.label}`,
          emailId: matchedId,
        });
        if (added) report.suppressed++;
      }

      if (matchedId) report.matched++;
      writes.push({
        event: {
          smtpConfigId,
          provider: provider.id,
          eventKey: event.eventKey,
          kind: event.kind,
          emailId: matchedId,
        },
        ...(matchedId ? { history: { emailId: matchedId, status: event.kind, detail } } : {}),
      });
    }

    await this.repository.saveEvents(writes);
    pinoLogger.info({ smtpConfigId, provider: provider.id, ...report }, "Bounce webhook applied");
    return report;
  }

  private async decryptRecipient(encrypted: string, emailId: string): Promise<string | null> {
    try {
      return await decrypt(encrypted, this.keys);
    } catch (err) {
      pinoLogger.error({ err, emailId }, "Bounce webhook could not read the email's recipient");
      return null;
    }
  }
}
