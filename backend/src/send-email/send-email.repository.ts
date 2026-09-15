import { emailLogs, emailHistories } from "@/db/schema";
import type { Database } from "@/db/connection";
import type { IEmailRepository } from "./send-email.types";

export class SendEmailRepository implements IEmailRepository {
  constructor(private readonly db: Database) {}

  async saveEmailLog(
    internalId : string,
    userId: string,
    to: string,
    subject: string,
    smtpId: string,
    sentAt: string,
    emailProcessingTimeMs: number,
    apiKeyId?: string | null,
  ): Promise<void> {
    await this.db.insert(emailLogs).values({
      internalId,
      userId,
      apiKeyId: apiKeyId || null,
      to,
      subject,
      smtpId,
      sentAt,
      emailProcessingTimeMs,
    });
  }
  async saveEmailHistory(
    emailId: string,
    status: string,
    error?: string,
  ): Promise<void> {
    await this.db.insert(emailHistories).values({
      emailId,
      status,
      error: error || null,
    });
  }
}
