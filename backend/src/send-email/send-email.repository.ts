import { emailLogs, emailHistories, emailContents, emailAttachments } from "@/db/schema";
import type { Database } from "@/db/connection";
import type {
  IEmailRepository,
  StoredEmail,
  StoredEmailContent,
  StoredEmailAttachment,
} from "./send-email.types";
import { asc, eq } from "drizzle-orm";

export class SendEmailRepository implements IEmailRepository {
  constructor(private readonly db: Database) {}

  async createPendingEmailLog(
    internalId: string,
    userId: string,
    to: string,
    subject: string,
    apiKeyId?: string | null,
  ): Promise<void> {
    await this.db.insert(emailLogs).values({
      internalId,
      userId,
      apiKeyId: apiKeyId || null,
      to,
      subject,
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

  async saveEmailAttachments(emailId: string, attachments: StoredEmailAttachment[]): Promise<void> {
    if (attachments.length === 0) return;
    // One statement per row: a single multi-row INSERT would carry several MB in one query.
    for (const [position, attachment] of attachments.entries()) {
      await this.db.insert(emailAttachments).values({ emailId, position, ...attachment });
    }
  }

  async getEmailAttachments(emailId: string): Promise<StoredEmailAttachment[]> {
    return this.db
      .select({
        filename: emailAttachments.filename,
        contentType: emailAttachments.contentType,
        content: emailAttachments.content,
      })
      .from(emailAttachments)
      .where(eq(emailAttachments.emailId, emailId))
      .orderBy(asc(emailAttachments.position));
  }
}
