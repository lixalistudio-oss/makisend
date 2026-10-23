export interface EmailLogRecord {
  internalId: string;
  userId: string;
  apiKeyId: string | null;
  to: string;
  subject: string;
  smtpId: string | null;
  sentAt: string | null;
  emailProcessingTimeMs: number | null;
  /** "api" for a POST /send-email, "test" for the dashboard's manual test send. */
  source: "api" | "test";
  /** Set for a test (the configuration it went through), NULL for an API send. */
  smtpConfigId: string | null;
  createdAt: string;
}

export interface EmailHistoryRecord {
  id: string;
  emailId: string;
  status: string;
  error: string | null;
  attempts: number | null;
  createdAt: string;
}

export interface EmailLogWithHistory extends EmailLogRecord {
  history: EmailHistoryRecord[];
}

export interface EmailLogFilters {
  smtpConfigId?: string;
  apiKeyId?: string;
  to?: string;
  status?: string;
}

export interface EmailLogPageFilters extends EmailLogFilters {
  /** Page size, capped at MAX_PAGE_SIZE by the repository. */
  limit?: number;
  /** Opaque cursor: "<createdAt>:<internalId>" of the last row of the previous page. */
  cursor?: string;
}

export interface EmailLogPage {
  logs: EmailLogWithHistory[];
  /** Pass back as `cursor` to fetch the next page; null when there are no more rows. */
  nextCursor: string | null;
}

export interface IEmailLogRepository {
  findPageByUserId(userId: string, filters?: EmailLogPageFilters): Promise<EmailLogPage>;
  findById(internalId: string): Promise<EmailLogWithHistory | null>;
}
