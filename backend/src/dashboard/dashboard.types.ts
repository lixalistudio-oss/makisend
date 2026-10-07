export interface DashboardStats {
  totalSent: number;
  successCount: number;
  failureCount: number;
  successRate: number;
}

export interface SmtpConfigBreakdown {
  smtpConfigId: string;
  senderEmail: string;
  totalSent: number;
  successCount: number;
  failureCount: number;
}

export interface RecentEmail {
  internalId: string;
  to: string;
  subject: string;
  status: string;
  sentAt: string;
  emailProcessingTimeMs: number | null;
}

export interface ErrorSummary {
  error: string;
  count: number;
}

export interface IDashboardRepository {
  getStats(userId: string, days?: number): Promise<DashboardStats>;
  getByConfig(userId: string, days?: number): Promise<SmtpConfigBreakdown[]>;
  getRecent(userId: string, limit?: number): Promise<RecentEmail[]>;
  getErrors(userId: string, days?: number, limit?: number): Promise<ErrorSummary[]>;
}
