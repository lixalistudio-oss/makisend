export interface EmailLogRecord {
  internalId: string;
  userId: string;
  apiKeyId: string | null;
  to: string;
  subject: string;
  smtpId: string | null;
  sentAt: string | null;
  emailProcessingTimeMs: number | null;
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
  to?: string;
  status?: string;
}

export interface IEmailLogRepository {
  findByUserId(userId: string, filters?: EmailLogFilters): Promise<EmailLogWithHistory[]>;
  findById(internalId: string): Promise<EmailLogWithHistory | null>;
}
