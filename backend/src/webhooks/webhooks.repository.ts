import { and, asc, desc, eq, gte, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { emailHistories, emailLogs, webhookDeliveries, webhookEndpoints } from "@/db/schema";
import type { Database } from "@/db/connection";
import type {
  IWebhookRepository,
  ListDeliveriesFilter,
  NewEmailDelivery,
  WebhookDeliveryRecord,
  WebhookDeliveryUpdate,
  WebhookEmailHistoryRow,
  WebhookEmailSource,
  WebhookEndpointInsert,
  WebhookEndpointRecord,
  WebhookEndpointUpdate,
} from "./webhooks.types";

type EndpointRow = typeof webhookEndpoints.$inferSelect;
type DeliveryRow = typeof webhookDeliveries.$inferSelect;

/**
 * D1 queries only: no encryption, no business rule. Every endpoint query is scoped by
 * `user_id` in the WHERE clause, so another user's endpoint is simply not found.
 */
export class WebhookRepository implements IWebhookRepository {
  constructor(private readonly db: Database) {}

  async findEndpointsByUser(userId: string): Promise<WebhookEndpointRecord[]> {
    const rows = await this.db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.userId, userId))
      .orderBy(asc(webhookEndpoints.createdAt), asc(webhookEndpoints.id));
    return rows.map(toEndpointRecord);
  }

  async findEndpoint(id: string, userId: string): Promise<WebhookEndpointRecord | null> {
    const rows = await this.db
      .select()
      .from(webhookEndpoints)
      .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.userId, userId)))
      .limit(1);
    return rows[0] ? toEndpointRecord(rows[0]) : null;
  }

  async insertEndpoint(userId: string, values: WebhookEndpointInsert): Promise<WebhookEndpointRecord> {
    const id = createId();
    await this.db.insert(webhookEndpoints).values({ id, userId, url: values.url, secret: values.secret });
    const created = await this.findEndpoint(id, userId);
    if (!created) throw new Error("Webhook endpoint not found right after insert");
    return created;
  }

  async updateEndpoint(
    id: string,
    userId: string,
    values: WebhookEndpointUpdate,
  ): Promise<WebhookEndpointRecord | null> {
    const rows = await this.db
      .update(webhookEndpoints)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.userId, userId)))
      .returning();
    return rows[0] ? toEndpointRecord(rows[0]) : null;
  }

  async deleteEndpoint(id: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .delete(webhookEndpoints)
      .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.userId, userId)))
      .returning({ id: webhookEndpoints.id });
    return rows.length > 0;
  }

  async listDeliveries(endpointId: string, filter: ListDeliveriesFilter): Promise<WebhookDeliveryRecord[]> {
    const conditions: SQL[] = [eq(webhookDeliveries.endpointId, endpointId)];
    if (filter.status) conditions.push(eq(webhookDeliveries.status, filter.status));
    if (filter.after) {
      const { createdAt, id } = filter.after;
      conditions.push(
        or(
          lt(webhookDeliveries.createdAt, createdAt),
          and(eq(webhookDeliveries.createdAt, createdAt), lt(webhookDeliveries.id, id)),
        )!,
      );
    }

    const rows = await this.db
      .select()
      .from(webhookDeliveries)
      .where(and(...conditions))
      .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
      .limit(filter.limit);
    return rows.map(toDeliveryRecord);
  }

  // --- Delivery pipeline ---

  async findEndpointById(id: string): Promise<WebhookEndpointRecord | null> {
    const rows = await this.db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, id)).limit(1);
    return rows[0] ? toEndpointRecord(rows[0]) : null;
  }

  async findEnabledEndpointsByUser(userId: string): Promise<WebhookEndpointRecord[]> {
    const rows = await this.db
      .select()
      .from(webhookEndpoints)
      .where(and(eq(webhookEndpoints.userId, userId), eq(webhookEndpoints.enabled, true)))
      .orderBy(asc(webhookEndpoints.createdAt), asc(webhookEndpoints.id));
    return rows.map(toEndpointRecord);
  }

  async insertEmailDeliveries(rows: NewEmailDelivery[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db
      .insert(webhookDeliveries)
      .values(rows.map((row) => ({ id: createId(), ...row, status: "pending" as const })))
      .onConflictDoNothing({ target: [webhookDeliveries.emailId, webhookDeliveries.endpointId] });
  }

  async findPendingDeliveriesForEmail(emailId: string): Promise<WebhookDeliveryRecord[]> {
    const rows = await this.db
      .select()
      .from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.emailId, emailId), eq(webhookDeliveries.status, "pending")));
    return rows.map(toDeliveryRecord);
  }

  async findDelivery(id: string): Promise<WebhookDeliveryRecord | null> {
    const rows = await this.db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id)).limit(1);
    return rows[0] ? toDeliveryRecord(rows[0]) : null;
  }

  async insertTestDelivery(endpointId: string): Promise<WebhookDeliveryRecord> {
    const rows = await this.db
      .insert(webhookDeliveries)
      .values({ id: createId(), endpointId, emailId: null, eventType: "webhook.test", status: "pending" })
      .returning();
    return toDeliveryRecord(rows[0]);
  }

  async updateDelivery(id: string, values: WebhookDeliveryUpdate): Promise<void> {
    if (Object.keys(values).length === 0) return;
    await this.db.update(webhookDeliveries).set(values).where(eq(webhookDeliveries.id, id));
  }

  async findTestDeliveriesSince(endpointId: string, since: Date): Promise<WebhookDeliveryRecord[]> {
    const rows = await this.db
      .select()
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.endpointId, endpointId),
          eq(webhookDeliveries.eventType, "webhook.test"),
          gte(webhookDeliveries.createdAt, since),
        ),
      )
      .orderBy(asc(webhookDeliveries.createdAt));
    return rows.map(toDeliveryRecord);
  }

  async countAttemptsSince(endpointId: string, since: Date): Promise<number> {
    const rows = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.endpointId, endpointId), gte(webhookDeliveries.lastAttemptAt, since)));
    return Number(rows[0]?.n ?? 0);
  }

  async resetFailedDelivery(id: string): Promise<WebhookDeliveryRecord | null> {
    const rows = await this.db
      .update(webhookDeliveries)
      .set({ status: "pending", attempts: 0, lastError: null, lastStatusCode: null })
      .where(and(eq(webhookDeliveries.id, id), eq(webhookDeliveries.status, "failed")))
      .returning();
    return rows[0] ? toDeliveryRecord(rows[0]) : null;
  }

  async resetEndpointFailures(id: string): Promise<void> {
    await this.db
      .update(webhookEndpoints)
      .set({ consecutiveFailures: 0 })
      .where(and(eq(webhookEndpoints.id, id), ne(webhookEndpoints.consecutiveFailures, 0)));
  }

  /** One UPDATE for the increment (no lost update between two consumers), then the disable. */
  async recordEndpointFailure(
    id: string,
    threshold: number,
  ): Promise<{ consecutiveFailures: number; disabled: boolean }> {
    const rows = await this.db
      .update(webhookEndpoints)
      .set({ consecutiveFailures: sql`${webhookEndpoints.consecutiveFailures} + 1` })
      .where(eq(webhookEndpoints.id, id))
      .returning({ consecutiveFailures: webhookEndpoints.consecutiveFailures, enabled: webhookEndpoints.enabled });
    const row = rows[0];
    if (!row) return { consecutiveFailures: 0, disabled: false };
    if (row.consecutiveFailures < threshold || !row.enabled) {
      return { consecutiveFailures: row.consecutiveFailures, disabled: false };
    }
    const disabled = await this.db
      .update(webhookEndpoints)
      .set({ enabled: false, disabledReason: "auto", updatedAt: new Date() })
      .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.enabled, true)))
      .returning({ id: webhookEndpoints.id });
    return { consecutiveFailures: row.consecutiveFailures, disabled: disabled.length > 0 };
  }

  async failStalePendingDeliveries(before: Date): Promise<number> {
    const rows = await this.db
      .update(webhookDeliveries)
      .set({ status: "failed", lastError: "abandoned: no attempt for 48 h" })
      .where(and(eq(webhookDeliveries.status, "pending"), lt(webhookDeliveries.createdAt, before)))
      .returning({ id: webhookDeliveries.id });
    return rows.length;
  }

  async findEmailForWebhook(emailId: string): Promise<WebhookEmailSource | null> {
    const rows = await this.db
      .select({
        emailId: emailLogs.internalId,
        userId: emailLogs.userId,
        to: emailLogs.to,
        subject: emailLogs.subject,
        apiKeyId: emailLogs.apiKeyId,
        smtpMessageId: emailLogs.smtpId,
        source: emailLogs.source,
        createdAt: emailLogs.createdAt,
      })
      .from(emailLogs)
      .where(eq(emailLogs.internalId, emailId))
      .limit(1);
    return rows[0] ?? null;
  }

  async findEmailHistories(emailId: string): Promise<WebhookEmailHistoryRow[]> {
    return this.db
      .select({
        status: emailHistories.status,
        error: emailHistories.error,
        attempts: emailHistories.attempts,
        createdAt: emailHistories.createdAt,
      })
      .from(emailHistories)
      .where(eq(emailHistories.emailId, emailId))
      .orderBy(asc(emailHistories.createdAt), asc(emailHistories.id));
  }
}

function toEndpointRecord(row: EndpointRow): WebhookEndpointRecord {
  return {
    id: row.id,
    userId: row.userId,
    url: row.url,
    secret: row.secret,
    previousSecret: row.previousSecret,
    previousSecretExpiresAt: row.previousSecretExpiresAt,
    enabled: row.enabled,
    disabledReason: row.disabledReason,
    consecutiveFailures: row.consecutiveFailures,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDeliveryRecord(row: DeliveryRow): WebhookDeliveryRecord {
  return {
    id: row.id,
    endpointId: row.endpointId,
    emailId: row.emailId,
    eventType: row.eventType,
    failureKind: row.failureKind,
    status: row.status,
    attempts: row.attempts,
    lastStatusCode: row.lastStatusCode,
    lastError: row.lastError,
    lastAttemptAt: row.lastAttemptAt,
    deliveredAt: row.deliveredAt,
    createdAt: row.createdAt,
  };
}
