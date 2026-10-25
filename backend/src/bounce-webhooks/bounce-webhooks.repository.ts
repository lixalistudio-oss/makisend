import { and, eq, inArray, lt } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Database } from "@/db/connection";
import { deliveryEvents, emailHistories, emailLogs, smtpConfig } from "@/db/schema";
import type { BounceWebhookProviderId, EventWrite, IBounceWebhookRepository } from "./bounce-webhooks.types";

/** D1 binds at most 100 parameters per statement: id lists are read in chunks below that. */
const IN_CHUNK = 90;
/** Statements sent per D1 batch (one round trip, one transaction). */
const BATCH_CHUNK = 50;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export class BounceWebhookRepository implements IBounceWebhookRepository {
  constructor(private readonly db: Database) {}

  async findWebhook(
    smtpConfigId: string,
  ): Promise<{ userId: string; provider: BounceWebhookProviderId; secret: string } | null> {
    const [row] = await this.db
      .select({
        userId: smtpConfig.userId,
        provider: smtpConfig.bounceWebhookProvider,
        secret: smtpConfig.bounceWebhookSecret,
      })
      .from(smtpConfig)
      .where(eq(smtpConfig.id, smtpConfigId))
      .limit(1);
    if (!row?.provider || !row.secret) return null;
    return { userId: row.userId, provider: row.provider, secret: row.secret };
  }

  /** The keys among `eventKeys` already recorded for this configuration. */
  async findRecordedEventKeys(smtpConfigId: string, eventKeys: string[]): Promise<Set<string>> {
    const recorded = new Set<string>();
    for (const part of chunks([...new Set(eventKeys)], IN_CHUNK)) {
      const rows = await this.db
        .select({ eventKey: deliveryEvents.eventKey })
        .from(deliveryEvents)
        .where(and(eq(deliveryEvents.smtpConfigId, smtpConfigId), inArray(deliveryEvents.eventKey, part)));
      for (const row of rows) recorded.add(row.eventKey);
    }
    return recorded;
  }

  /** Owner and encrypted recipient of each logged email among `emailIds`. */
  async findEmails(emailIds: string[]): Promise<Map<string, { userId: string; to: string }>> {
    const found = new Map<string, { userId: string; to: string }>();
    for (const part of chunks([...new Set(emailIds)], IN_CHUNK)) {
      const rows = await this.db
        .select({ id: emailLogs.internalId, userId: emailLogs.userId, to: emailLogs.to })
        .from(emailLogs)
        .where(inArray(emailLogs.internalId, part));
      for (const row of rows) found.set(row.id, { userId: row.userId, to: row.to });
    }
    return found;
  }

  /**
   * Writes the events and their history rows, a D1 batch at a time: a failed call writes
   * nothing of its chunk, so the provider's retry applies it again. The unique index on
   * (config, event key) keeps a concurrent duplicate from being recorded twice.
   */
  async saveEvents(writes: EventWrite[]): Promise<void> {
    const statements: BatchItem<"sqlite">[] = [];
    for (const { event, history } of writes) {
      statements.push(
        this.db
          .insert(deliveryEvents)
          .values(event)
          .onConflictDoNothing({ target: [deliveryEvents.smtpConfigId, deliveryEvents.eventKey] }),
      );
      if (history) {
        statements.push(
          this.db.insert(emailHistories).values({
            emailId: history.emailId,
            status: history.status,
            error: history.detail,
          }),
        );
      }
    }
    for (const part of chunks(statements, BATCH_CHUNK)) {
      const [first, ...rest] = part;
      if (first) await this.db.batch([first, ...rest]);
    }
  }

  async deleteEventsBefore(before: string): Promise<number> {
    const result = await this.db.delete(deliveryEvents).where(lt(deliveryEvents.createdAt, before)).run();
    return result.meta.changes ?? 0;
  }
}
