import { emailLogs, emailHistories, apikey, smtpConfig } from "@/db/schema";
import type { Database } from "@/db/connection";
import type { IDashboardRepository, DashboardStats, SmtpConfigBreakdown, RecentEmail, ErrorSummary } from "./dashboard.types";
import { eq, and, desc, sql, gte, type SQL } from "drizzle-orm";

export class DashboardRepository implements IDashboardRepository {
  constructor(private readonly db: Database) {}

  async getStats(userId: string, days?: number): Promise<DashboardStats> {
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
      .where(this.scopedToUser(userId, days));

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

  async getErrors(userId: string, days?: number, limit?: number): Promise<ErrorSummary[]> {
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
          this.withinWindow(days),
          eq(emailHistories.status, "failed"),
        ),
      )
      .groupBy(emailHistories.error)
      .orderBy(desc(sql`count(*)`))
      .limit(limit || 10);

    return rows.map((r) => ({ error: r.error, count: Number(r.count) }));
  }

  private scopedToUser(userId: string, days?: number): SQL | undefined {
    return and(eq(emailLogs.userId, userId), this.withinWindow(days));
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
