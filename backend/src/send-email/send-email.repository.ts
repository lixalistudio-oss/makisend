import { emailLogs, emailHistories, emailContents } from "@/db/schema";
import type { Database } from "@/db/connection";
import type {
  IEmailRepository,
  PendingEmailLogOptions,
  StoredEmail,
  StoredEmailContent,
} from "./send-email.types";
import { eq } from "drizzle-orm";

export class SendEmailRepository implements IEmailRepository {
  constructor(private readonly db: Database) {}

  async createPendingEmailLog(
    internalId: string,
    userId: string,
    to: string,
    subject: string,
    apiKeyId?: string | null,
    options: PendingEmailLogOptions = {},
  ): Promise<void> {
    await this.db.insert(emailLogs).values({
      internalId,
      userId,
      apiKeyId: apiKeyId || null,
      to,
      subject,
      source: options.source ?? "api",
      smtpConfigId: options.smtpConfigId ?? null,
      // smtp_id / sent_at remain NULL until completeEmailLog() runs
    });
  }

  async completeEmailLog(
    internalId: string,
    smtpId: string,
    sentAt: string,
    emailProcessingTimeMs: number,
  ): Promise<void> {
    await this.db
      .update(emailLogs)
      .set({ smtpId, sentAt, emailProcessingTimeMs })
      .where(eq(emailLogs.internalId, internalId));
  }

  async saveEmailHistory(
    emailId: string,
    status: string,
    error?: string,
    attempts?: number,
  ): Promise<void> {
    await this.db.insert(emailHistories).values({
      emailId,
      status,
      error: error || null,
      attempts: attempts ?? null,
    });
  }

  async saveEmailContent(
    emailId: string,
    content: StoredEmailContent,
  ): Promise<void> {
    await this.db.insert(emailContents).values({
      emailId,
      textBody: content.text,
      htmlBody: content.html,
      smtpConfigId: content.smtpConfigId ?? null,
    });
  }

  async getEmailForSending(emailId: string): Promise<StoredEmail | null> {
    const [row] = await this.db
      .select({
        to: emailLogs.to,
        subject: emailLogs.subject,
        text: emailContents.textBody,
        html: emailContents.htmlBody,
        smtpConfigId: emailContents.smtpConfigId,
      })
      .from(emailContents)
      .innerJoin(emailLogs, eq(emailLogs.internalId, emailContents.emailId))
      .where(eq(emailContents.emailId, emailId))
      .limit(1);

    return row ?? null;
  }
}
