import { emailLogs, emailHistories, apikey, smtpConfig } from "@/db/schema";
import type { Database } from "@/db/connection";
import type { IDashboardRepository, DashboardStats, SmtpConfigBreakdown, RecentEmail, ErrorSummary } from "./dashboard.types";
import { eq, and, desc, sql, gte } from "drizzle-orm";

export class DashboardRepository implements IDashboardRepository {
  constructor(private readonly db: Database) {}

  async getStats(userId: string, days?: number): Promise<DashboardStats> {
    const since = days ? this.getSinceDate(days) : undefined;

    // Ordered by created_at (not sent_at): failed/pending emails have sent_at NULL.
    const logs = await this.db
      .select({ internalId: emailLogs.internalId })
      .from(emailLogs)
      .where(
        since
          ? and(eq(emailLogs.userId, userId), gte(emailLogs.createdAt, since))
          : eq(emailLogs.userId, userId),
      );

    const totalSent = logs.length;

    if (totalSent === 0) {
      return { totalSent: 0, successCount: 0, failureCount: 0, successRate: 0 };
    }

    const logIds = logs.map((l) => l.internalId);

    const histories = await this.db
      .select({ status: emailHistories.status })
      .from(emailHistories)
      .where(sql`${emailHistories.emailId} IN ${logIds}`);

    const successCount = histories.filter((h) => h.status === "sent").length;
    const failureCount = histories.filter((h) => h.status === "failed").length;
    const successRate = totalSent > 0 ? Math.round((successCount / totalSent) * 100) : 0;

    return { totalSent, successCount, failureCount, successRate };
  }

  async getByConfig(userId: string, days?: number): Promise<SmtpConfigBreakdown[]> {
    const since = days ? this.getSinceDate(days) : undefined;

    // Get all API keys for this user
    const keys = await this.db
      .select({ id: apikey.id, smtpConfigId: apikey.smtpConfigId })
      .from(apikey)
      .where(eq(apikey.referenceId, userId));

    const keyIds = keys.map((k) => k.id);
    if (keyIds.length === 0) return [];

    // Get all logs for these keys
    const logs = await this.db
      .select({ internalId: emailLogs.internalId, apiKeyId: emailLogs.apiKeyId })
      .from(emailLogs)
      .where(
        since
          ? and(sql`${emailLogs.apiKeyId} IN ${keyIds}`, gte(emailLogs.createdAt, since))
          : sql`${emailLogs.apiKeyId} IN ${keyIds}`,
      );

    // Get histories for these logs
    const logIds = logs.map((l) => l.internalId);
    if (logIds.length === 0) return [];

    const histories = await this.db
      .select({ emailId: emailHistories.emailId, status: emailHistories.status })
      .from(emailHistories)
      .where(sql`${emailHistories.emailId} IN ${logIds}`);

    // Get SMTP configs for these keys
    const configIds = keys.filter((k) => k.smtpConfigId).map((k) => k.smtpConfigId!);
    if (configIds.length === 0) return [];

    const configs = await this.db
      .select({ id: smtpConfig.id, senderEmail: smtpConfig.senderEmail })
      .from(smtpConfig)
      .where(sql`${smtpConfig.id} IN ${configIds}`);

    // Build breakdown
    const breakdown: SmtpConfigBreakdown[] = [];

    for (const config of configs) {
      const configKeyIds = keys.filter((k) => k.smtpConfigId === config.id).map((k) => k.id);
      const configLogs = logs.filter((l) => configKeyIds.includes(l.apiKeyId || ""));
      const configLogIds = configLogs.map((l) => l.internalId);
      const configHistories = histories.filter((h) => configLogIds.includes(h.emailId));

      breakdown.push({
        smtpConfigId: config.id,
        senderEmail: config.senderEmail,
        totalSent: configLogs.length,
        successCount: configHistories.filter((h) => h.status === "sent").length,
        failureCount: configHistories.filter((h) => h.status === "failed").length,
      });
    }

    return breakdown;
  }

  async getRecent(userId: string, limit?: number): Promise<RecentEmail[]> {
    const logs = await this.db
      .select()
      .from(emailLogs)
      .where(eq(emailLogs.userId, userId))
      .orderBy(desc(emailLogs.createdAt))
      .limit(limit || 20);

    const result: RecentEmail[] = [];

    for (const log of logs) {
      // Latest history entry wins — the old query returned the FIRST row
      // (usually "received"), so every badge showed the wrong status.
      const history = await this.db
        .select({ status: emailHistories.status })
        .from(emailHistories)
        .where(eq(emailHistories.emailId, log.internalId))
        .orderBy(desc(emailHistories.createdAt))
        .limit(1);

      result.push({
        internalId: log.internalId,
        to: log.to,
        subject: log.subject,
        status: history[0]?.status || "unknown",
        sentAt: log.sentAt ?? log.createdAt,
        emailProcessingTimeMs: log.emailProcessingTimeMs,
      });
    }

    return result;
  }

  async getErrors(userId: string, days?: number, limit?: number): Promise<ErrorSummary[]> {
    const since = days ? this.getSinceDate(days) : undefined;

    // Get logs for this user (failed emails have sent_at NULL, so filter on created_at)
    const logs = await this.db
      .select({ internalId: emailLogs.internalId })
      .from(emailLogs)
      .where(
        since
          ? and(eq(emailLogs.userId, userId), gte(emailLogs.createdAt, since))
          : eq(emailLogs.userId, userId),
      );

    const logIds = logs.map((l) => l.internalId);
    if (logIds.length === 0) return [];

    // Get failed histories with errors
    const failedHistories = await this.db
      .select({ error: emailHistories.error })
      .from(emailHistories)
      .where(
        and(
          sql`${emailHistories.emailId} IN ${logIds}`,
          eq(emailHistories.status, "failed"),
        ),
      );

    // Count by error message
    const errorCounts = new Map<string, number>();
    for (const h of failedHistories) {
      const errorMsg = h.error || "Unknown error";
      errorCounts.set(errorMsg, (errorCounts.get(errorMsg) || 0) + 1);
    }

    // Sort by count descending and take top N
    const sorted = Array.from(errorCounts.entries())
      .map(([error, count]) => ({ error, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit || 10);

    return sorted;
  }

  private getSinceDate(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString();
  }
}
