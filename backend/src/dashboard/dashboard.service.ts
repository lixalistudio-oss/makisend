import { pinoLogger } from "@/core/logger";
import type { IDashboardRepository, DashboardStats, SmtpConfigBreakdown, RecentEmail, ErrorSummary } from "./dashboard.types";

export class DashboardService {
  constructor(private readonly dashboardRepo: IDashboardRepository) {}

  async getStats(userId: string, days?: number): Promise<DashboardStats> {
    pinoLogger.info({ userId, days }, "Fetching dashboard stats");
    return this.dashboardRepo.getStats(userId, days);
  }

  async getByConfig(userId: string, days?: number): Promise<SmtpConfigBreakdown[]> {
    pinoLogger.info({ userId, days }, "Fetching dashboard SMTP config breakdown");
    return this.dashboardRepo.getByConfig(userId, days);
  }

  async getRecent(userId: string, limit?: number): Promise<RecentEmail[]> {
    pinoLogger.info({ userId, limit }, "Fetching recent emails");
    return this.dashboardRepo.getRecent(userId, limit);
  }

  async getErrors(userId: string, days?: number, limit?: number): Promise<ErrorSummary[]> {
    pinoLogger.info({ userId, days, limit }, "Fetching error summary");
    return this.dashboardRepo.getErrors(userId, days, limit);
  }
}
