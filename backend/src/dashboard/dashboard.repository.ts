import { emailLogs, emailHistories, apikey, smtpConfig } from "@/db/schema";
import type { Database } from "@/db/connection";
import type { IDashboardRepository, DashboardStats, SmtpConfigBreakdown, ApiKeyMetrics, RecentEmail, ErrorSummary } from "./dashboard.types";
import { eq, and, desc, sql, gte, type SQL } from "drizzle-orm";

export class DashboardRepository implements IDashboardRepository {
  constructor(private readonly db: Database) {}

  async getStats(userId: string, days?: number, apiKeyId?: string): Promise<DashboardStats> {
    // Aggregated in SQL: the old version loaded every log id and every history
    // row into the Worker just to count them (1000 emails => ~6000 rows read).
    const rows = await this.db
      .select({
        totalSent: sql<number>`count(distinct ${emailLogs.internalId})`,
        successCount: sql<number>`count(distinct case when ${emailHistories.status} = 'sent' then ${emailLogs.internalId} end)`,
        failureCount: sql<number>`count(distinct case when ${emailHistories.status} = 'failed' then ${emailLogs.internalId} end)`,
      })
      .from(emailLogs)
      .leftJoin(emailHistories, eq(emailHistories.emailId, emailLogs.internalId))
      .where(this.scopedToUser(userId, days, apiKeyId));

    const totalSent = Number(rows[0]?.totalSent ?? 0);
    const successCount = Number(rows[0]?.successCount ?? 0);
    const failureCount = Number(rows[0]?.failureCount ?? 0);
    const successRate = totalSent > 0 ? Math.round((successCount / totalSent) * 100) : 0;

    return { totalSent, successCount, failureCount, successRate };
  }

  async getByConfig(userId: string, days?: number): Promise<SmtpConfigBreakdown[]> {
    // Grouped join: returns one row per SMTP config instead of all logs +
    // all histories + configs, then filtering them in JS.
    const rows = await this.db
      .select({
        smtpConfigId: smtpConfig.id,
        senderEmail: smtpConfig.senderEmail,
        totalSent: sql<number>`count(distinct ${emailLogs.internalId})`,
        successCount: sql<number>`count(distinct case when ${emailHistories.status} = 'sent' then ${emailLogs.internalId} end)`,
        failureCount: sql<number>`count(distinct case when ${emailHistories.status} = 'failed' then ${emailLogs.internalId} end)`,
      })
      .from(smtpConfig)
      .innerJoin(apikey, eq(apikey.smtpConfigId, smtpConfig.id))
      .leftJoin(
        emailLogs,
        and(
          eq(emailLogs.apiKeyId, apikey.id),
          eq(emailLogs.userId, userId),
          this.withinWindow(days),
        ),
      )
      .leftJoin(emailHistories, eq(emailHistories.emailId, emailLogs.internalId))
      .where(eq(smtpConfig.userId, userId))
      .groupBy(smtpConfig.id, smtpConfig.senderEmail);

    return rows.map((r) => ({
      smtpConfigId: r.smtpConfigId,
      senderEmail: r.senderEmail,
      totalSent: Number(r.totalSent),
      successCount: Number(r.successCount),
      failureCount: Number(r.failureCount),
    }));
  }

  async getByApiKey(userId: string, days?: number): Promise<ApiKeyMetrics[]> {
    // One row per key, keys that sent nothing included (left join), so the dashboard can
    // show a quiet key as zeroes instead of hiding it. The status checks are EXISTS
    // subqueries rather than a join on email_histories: a join repeats each email once
    // per history row, which would skew the average processing time.
    const sentCheck = sql`exists (select 1 from ${emailHistories} h where h.email_id = ${emailLogs.internalId} and h.status = 'sent')`;
    const failedCheck = sql`exists (select 1 from ${emailHistories} h where h.email_id = ${emailLogs.internalId} and h.status = 'failed')`;

    const rows = await this.db
      .select({
        apiKeyId: apikey.id,
        name: apikey.name,
        prefix: apikey.prefix,
        start: apikey.start,
        enabled: apikey.enabled,
        totalSent: sql<number>`count(${emailLogs.internalId})`,
        successCount: sql<number>`count(case when ${sentCheck} then 1 end)`,
        failureCount: sql<number>`count(case when ${failedCheck} then 1 end)`,
        avgProcessingTimeMs: sql<number | null>`avg(${emailLogs.emailProcessingTimeMs})`,
        lastUsedAt: sql<string | null>`max(${emailLogs.createdAt})`,
      })
      .from(apikey)
      .leftJoin(
        emailLogs,
        and(
          eq(emailLogs.apiKeyId, apikey.id),
          eq(emailLogs.userId, userId),
          this.withinWindow(days),
        ),
      )
      .where(eq(apikey.referenceId, userId))
      .groupBy(apikey.id)
      .orderBy(desc(apikey.createdAt));

    return rows.map((r) => {
      const totalSent = Number(r.totalSent);
      const successCount = Number(r.successCount);
      return {
        apiKeyId: r.apiKeyId,
        name: r.name,
        prefix: r.prefix,
        start: r.start,
        enabled: r.enabled ?? true,
        totalSent,
        successCount,
        failureCount: Number(r.failureCount),
        successRate: totalSent > 0 ? Math.round((successCount / totalSent) * 100) : 0,
        avgProcessingTimeMs: r.avgProcessingTimeMs == null ? null : Math.round(Number(r.avgProcessingTimeMs)),
        lastUsedAt: r.lastUsedAt,
      };
    });
  }

  async getRecent(userId: string, limit?: number): Promise<RecentEmail[]> {
    // Single query: latest history status per email via a correlated subquery
    // (backed by emailHistories_emailId_createdAt_idx) — replaces the N+1 loop
    // that ran one query per email (20 emails => 21 queries).
    const rows = await this.db
      .select({
        internalId: emailLogs.internalId,
        to: emailLogs.to,
        subject: emailLogs.subject,
        sentAt: emailLogs.sentAt,
        createdAt: emailLogs.createdAt,
        emailProcessingTimeMs: emailLogs.emailProcessingTimeMs,
        status: sql<string | null>`(
          select h.status from ${emailHistories} h
          where h.email_id = ${emailLogs.internalId}
          order by h.created_at desc
          limit 1
        )`,
      })
      .from(emailLogs)
      .where(eq(emailLogs.userId, userId))
      .orderBy(desc(emailLogs.createdAt))
      .limit(limit || 20);

    return rows.map((r) => ({
      internalId: r.internalId,
      to: r.to,
      subject: r.subject,
      status: r.status || "unknown",
      sentAt: r.sentAt ?? r.createdAt,
      emailProcessingTimeMs: r.emailProcessingTimeMs,
    }));
  }

  async getErrors(userId: string, days?: number, limit?: number, apiKeyId?: string): Promise<ErrorSummary[]> {
    // COUNT + GROUP BY in SQL: only the top N error strings come back instead
    // of every failed history row.
    const rows = await this.db
      .select({
        error: sql<string>`coalesce(${emailHistories.error}, 'Unknown error')`,
        count: sql<number>`count(*)`,
      })
      .from(emailLogs)
      .innerJoin(emailHistories, eq(emailHistories.emailId, emailLogs.internalId))
      .where(
        and(
          eq(emailLogs.userId, userId),
          eq(emailLogs.source, "api"),
          this.withinWindow(days),
          apiKeyId ? eq(emailLogs.apiKeyId, apiKeyId) : undefined,
          eq(emailHistories.status, "failed"),
        ),
      )
      .groupBy(emailHistories.error)
      .orderBy(desc(sql`count(*)`))
      .limit(limit || 10);

    return rows.map((r) => ({ error: r.error, count: Number(r.count) }));
  }

  private scopedToUser(userId: string, days?: number, apiKeyId?: string): SQL | undefined {
    return and(
      eq(emailLogs.userId, userId),
      eq(emailLogs.source, "api"),
      this.withinWindow(days),
      apiKeyId ? eq(emailLogs.apiKeyId, apiKeyId) : undefined,
    );
  }

  private withinWindow(days?: number): SQL | undefined {
    return days ? gte(emailLogs.createdAt, this.getSinceDate(days)) : undefined;
  }

  private getSinceDate(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString();
  }
}
