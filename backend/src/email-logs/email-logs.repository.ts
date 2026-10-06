import { emailLogs, emailHistories, apikey } from "@/db/schema";
import type { Database } from "@/db/connection";
import type { IEmailLogRepository, EmailLogRecord, EmailHistoryRecord, EmailLogWithHistory, EmailLogFilters } from "./email-logs.types";
import { eq, and, desc } from "drizzle-orm";

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
            // Filter by apiKeyId — we need to check each one
          ),
        )
        .orderBy(desc(emailLogs.createdAt));

      // Filter by apiKeyId in JS since Drizzle doesn't support IN easily with typed arrays
      const filteredLogs = logs.filter((log) => apiKeyIds.includes(log.apiKeyId || ""));

      return this.attachHistory(filteredLogs, filters);
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
    const results: EmailLogWithHistory[] = [];

    for (const log of logs) {
      const history = await this.db
        .select()
        .from(emailHistories)
        .where(eq(emailHistories.emailId, log.internalId))
        .orderBy(emailHistories.createdAt);

      const record = {
        ...this.toLogRecord(log),
        history: history.map(this.toHistoryRecord),
      };

      // Filter by status if specified
      if (filters?.status) {
        const hasStatus = record.history.some((h) => h.status === filters.status);
        if (!hasStatus) continue;
      }

      results.push(record);
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
