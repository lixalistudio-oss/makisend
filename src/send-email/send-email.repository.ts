import { emailLogs } from "@/db/schema";
import type { Database } from "@/db/connection";
import type { IEmailRepository } from "./send-email.types";

export class SendEmailRepository implements IEmailRepository {
  constructor(private readonly db: Database) {}

  async saveEmailLog(
    to: string,
    subject: string,
    smtpId: string,
    sentAt: string,
    emailProcessingTimeMs: number,
  ): Promise<void> {
    await this.db.insert(emailLogs).values({
      to,
      subject,
      smtpId,
      sentAt,
      emailProcessingTimeMs,
    });
  }
}
