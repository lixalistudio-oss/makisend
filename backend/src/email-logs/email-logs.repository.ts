import { emailLogs, emailHistories, apikey } from "@/db/schema";
import type { Database } from "@/db/connection";
import type {
  EmailLogRecord,
  EmailHistoryRecord,
  EmailLogWithHistory,
  EmailLogPageFilters,
  EmailLogPage,
  IEmailLogRepository,
} from "./email-logs.types";
import { eq, and, or, lt, desc, inArray, sql, type SQL } from "drizzle-orm";

// D1 allows at most 100 bound parameters per query. The history lookup below
// binds one parameter per log id, so a page can never exceed 100 logs — this is
// what broke the endpoint once a user crossed 100 total logs ("too many SQL
// variables"): the old code loaded EVERY log, then built one giant IN (...).
export const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;

interface LogCursor {
  createdAt: string;
  internalId: string;
}

function encodeCursor(cursor: LogCursor): string {
  return `${cursor.createdAt}:${cursor.internalId}`;
}

// createdAt is always a full ISO string and internalId never contains ":",
// so split on the last ":"; the time component contains earlier colons.
export function decodeCursor(raw: string): LogCursor | null {
  const separatorIndex = raw.lastIndexOf(":");
  if (separatorIndex <= 0 || separatorIndex === raw.length - 1) return null;
  return {
    createdAt: raw.slice(0, separatorIndex),
    internalId: raw.slice(separatorIndex + 1),
  };
}

export class EmailLogRepository implements IEmailLogRepository {
  constructor(private readonly db: Database) {}

  async findPageByUserId(userId: string, filters?: EmailLogPageFilters): Promise<EmailLogPage> {
    const pageSize = Math.min(Math.max(filters?.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);

    const conditions: SQL[] = [eq(emailLogs.userId, userId)];

    if (filters?.smtpConfigId) {
      // Subquery instead of inArray(apiKeyIds): same 100-param trap if the user
      // ever owns more than 100 API keys.
      conditions.push(
        sql`${emailLogs.apiKeyId} in (
          select ${apikey.id} from ${apikey} where ${apikey.smtpConfigId} = ${filters.smtpConfigId}
        )`,
      );
    }

    if (filters?.status) {
      // EXISTS instead of filtering in JS after loading every history row.
      conditions.push(
        sql`exists (
          select 1 from ${emailHistories}
          where ${emailHistories.emailId} = ${emailLogs.internalId}
            and ${emailHistories.status} = ${filters.status}
        )`,
      );
    }

    const cursor = filters?.cursor ? decodeCursor(filters.cursor) : null;
    if (cursor) {
      // Keyset pagination on (createdAt, internalId) DESC — createdAt is an ISO
      // string, so lexicographic order is chronological order.
      conditions.push(
        or(
          lt(emailLogs.createdAt, cursor.createdAt),
          and(eq(emailLogs.createdAt, cursor.createdAt), lt(emailLogs.internalId, cursor.internalId)),
        ) as SQL,
      );
    }

    // Fetch one extra row to know whether another page exists without a COUNT.
    const rows = await this.db
      .select()
      .from(emailLogs)
      .where(and(...conditions))
      .orderBy(desc(emailLogs.createdAt), desc(emailLogs.internalId))
      .limit(pageSize + 1);

    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;
    const last = page[page.length - 1];

    const logsWithHistory = await this.attachHistory(page);

    return {
      logs: logsWithHistory,
      nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt, internalId: last.internalId }) : null,
    };
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
  ): Promise<EmailLogWithHistory[]> {
    if (logs.length === 0) return [];

    // One query for every history row instead of one query per log (N+1).
    // logs.length <= MAX_PAGE_SIZE, so the IN (...) stays under D1's
    // 100-bound-parameter limit.
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

    return logs.map((log) => ({
      ...this.toLogRecord(log),
      history: byEmail.get(log.internalId) ?? [],
    }));
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
