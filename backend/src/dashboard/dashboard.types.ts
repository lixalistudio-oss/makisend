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

export interface ApiKeyMetrics {
  apiKeyId: string;
  name: string | null;
  prefix: string | null;
  start: string | null;
  enabled: boolean;
  totalSent: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  /** Mean of email_processing_time over the window, null when nothing was delivered. */
  avgProcessingTimeMs: number | null;
  /** created_at of the newest email in the window, null when the key sent nothing. */
  lastUsedAt: string | null;
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
  getStats(userId: string, days?: number, apiKeyId?: string): Promise<DashboardStats>;
  getByConfig(userId: string, days?: number): Promise<SmtpConfigBreakdown[]>;
  getByApiKey(userId: string, days?: number): Promise<ApiKeyMetrics[]>;
  getRecent(userId: string, limit?: number): Promise<RecentEmail[]>;
  getErrors(userId: string, days?: number, limit?: number, apiKeyId?: string): Promise<ErrorSummary[]>;
}
