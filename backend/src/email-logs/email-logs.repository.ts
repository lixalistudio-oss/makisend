import { emailLogs, emailHistories, apikey } from "@/db/schema";
import type { Database } from "@/db/connection";
import type { IEmailLogRepository, EmailLogRecord, EmailHistoryRecord, EmailLogWithHistory, EmailLogFilters } from "./email-logs.types";
import { eq, and, desc, inArray } from "drizzle-orm";

export class EmailLogRepository implements IEmailLogRepository {
  constructor(private readonly db: Database) {}

  async findByUserId(userId: string, filters?: EmailLogFilters): Promise<EmailLogWithHistory[]> {
    // If filtering by smtpConfigId, we need to join with apikey
    if (filters?.smtpConfigId) {
      const apiKeyRecords = await this.db
        .select({ id: apikey.id })
        .from(apikey)
        .where(eq(apikey.smtpConfigId, filters.smtpConfigId));

      const apiKeyIds = apiKeyRecords.map((r) => r.id);

      if (apiKeyIds.length === 0) {
        return [];
      }

      const logs = await this.db
        .select()
        .from(emailLogs)
        .where(
          and(
            eq(emailLogs.userId, userId),
            // Filtered in SQL instead of fetching every log and dropping most
            // of them in JS.
            inArray(emailLogs.apiKeyId, apiKeyIds),
          ),
        )
        .orderBy(desc(emailLogs.createdAt));

      return this.attachHistory(logs, filters);
    }

    const logs = await this.db
      .select()
      .from(emailLogs)
      .where(eq(emailLogs.userId, userId))
      .orderBy(desc(emailLogs.createdAt));

    return this.attachHistory(logs, filters);
  }

  async findById(internalId: string): Promise<EmailLogWithHistory | null> {
    const result = await this.db
      .select()
      .from(emailLogs)
      .where(eq(emailLogs.internalId, internalId))
      .limit(1);

    if (!result[0]) return null;

    const history = await this.db
      .select()
      .from(emailHistories)
      .where(eq(emailHistories.emailId, internalId))
      .orderBy(emailHistories.createdAt);

    return {
      ...this.toLogRecord(result[0]),
      history: history.map(this.toHistoryRecord),
    };
  }

  private async attachHistory(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    logs: any[],
    filters?: EmailLogFilters,
  ): Promise<EmailLogWithHistory[]> {
    if (logs.length === 0) return [];

    // One query for every history row instead of one query per log (N+1):
    // 1000 logs used to mean 1000 round-trips to D1.
    const ids = logs.map((log) => log.internalId);
    const allHistory = await this.db
      .select()
      .from(emailHistories)
      .where(inArray(emailHistories.emailId, ids))
      .orderBy(emailHistories.createdAt);

    const byEmail = new Map<string, EmailHistoryRecord[]>();
    for (const row of allHistory) {
      const record = this.toHistoryRecord(row);
      const bucket = byEmail.get(record.emailId);
      if (bucket) bucket.push(record);
      else byEmail.set(record.emailId, [record]);
    }

    const results: EmailLogWithHistory[] = [];

    for (const log of logs) {
      const history = byEmail.get(log.internalId) ?? [];

      // Filter by status if specified
      if (filters?.status && !history.some((h) => h.status === filters.status)) {
        continue;
      }

      results.push({
        ...this.toLogRecord(log),
        history,
      });
    }

    return results;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toLogRecord(row: any): EmailLogRecord {
    return {
      internalId: row.internalId,
      userId: row.userId,
      apiKeyId: row.apiKeyId,
      to: row.to,
      subject: row.subject,
      smtpId: row.smtpId,
      sentAt: row.sentAt,
      emailProcessingTimeMs: row.emailProcessingTimeMs,
      createdAt: row.createdAt,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toHistoryRecord(row: any): EmailHistoryRecord {
    return {
      id: row.id,
      emailId: row.emailId,
      status: row.status,
      error: row.error,
      attempts: row.attempts,
      createdAt: row.createdAt,
    };
  }
}
