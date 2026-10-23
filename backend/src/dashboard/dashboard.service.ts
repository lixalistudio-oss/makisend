import type { KeyMaterial } from "@/core/crypto";
import { decrypt } from "@/core/crypto";
import { pinoLogger } from "@/core/logger";
import type { IDashboardRepository, DashboardStats, SmtpConfigBreakdown, RecentEmail, ErrorSummary } from "./dashboard.types";

export class DashboardService {
  constructor(
    private readonly dashboardRepo: IDashboardRepository,
    private readonly aesKey: KeyMaterial,
  ) {}

  async getStats(userId: string, days?: number): Promise<DashboardStats> {
    pinoLogger.info({ userId, days }, "Fetching dashboard stats");
    return this.dashboardRepo.getStats(userId, days);
  }

  async getByConfig(userId: string, days?: number): Promise<SmtpConfigBreakdown[]> {
    pinoLogger.info({ userId, days }, "Fetching dashboard SMTP config breakdown");
    const breakdown = await this.dashboardRepo.getByConfig(userId, days);
    return Promise.all(breakdown.map((b) => this.decryptBreakdown(b)));
  }

  async getRecent(userId: string, limit?: number): Promise<RecentEmail[]> {
    pinoLogger.info({ userId, limit }, "Fetching recent emails");
    const recent = await this.dashboardRepo.getRecent(userId, limit);
    return Promise.all(recent.map((r) => this.decryptRecent(r)));
  }

  async getErrors(userId: string, days?: number, limit?: number): Promise<ErrorSummary[]> {
    pinoLogger.info({ userId, days, limit }, "Fetching error summary");
    return this.dashboardRepo.getErrors(userId, days, limit);
  }

  private async decryptBreakdown(item: SmtpConfigBreakdown): Promise<SmtpConfigBreakdown> {
    const senderEmail = await decrypt(item.senderEmail, this.aesKey);
    return { ...item, senderEmail };
  }

  private async decryptRecent(item: RecentEmail): Promise<RecentEmail> {
    const to = await decrypt(item.to, this.aesKey);
    return { ...item, to };
  }
}
