import { smtpConfig } from "@/db/schema";
import type { Database } from "@/db/connection";
import type { ISmtpConfigRepository, SmtpConfigInput, SmtpConfigUpdateInput, SmtpConfigRecord } from "./smtp-config.types";
import { eq } from "drizzle-orm";

export class SmtpConfigRepository implements ISmtpConfigRepository {
  constructor(private readonly db: Database) {}

  async create(userId: string, input: SmtpConfigInput): Promise<SmtpConfigRecord> {
    const result = await this.db
      .insert(smtpConfig)
      .values({
        userId,
        smtpHostname: input.smtpHostname,
        smtpUsername: input.smtpUsername,
        smtpPassword: input.smtpPassword,
        senderEmail: input.senderEmail,
      })
      .returning();

    return this.toRecord(result[0]);
  }

  async findByUserId(userId: string): Promise<SmtpConfigRecord[]> {
    const results = await this.db
      .select()
      .from(smtpConfig)
      .where(eq(smtpConfig.userId, userId));

    return results.map(this.toRecord);
  }

  async findById(id: string): Promise<SmtpConfigRecord | null> {
    const result = await this.db
      .select()
      .from(smtpConfig)
      .where(eq(smtpConfig.id, id))
      .limit(1);

    return result[0] ? this.toRecord(result[0]) : null;
  }

  async update(id: string, input: SmtpConfigUpdateInput): Promise<SmtpConfigRecord> {
    const result = await this.db
      .update(smtpConfig)
      .set(input)
      .where(eq(smtpConfig.id, id))
      .returning();

    return this.toRecord(result[0]);
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(smtpConfig).where(eq(smtpConfig.id, id));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toRecord(row: any): SmtpConfigRecord {
    return {
      id: row.id,
      userId: row.user_id,
      smtpHostname: row.smtphostname,
      smtpUsername: row.smtpusername,
      smtpPassword: row.smtppassword,
      senderEmail: row.sender_email,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
