import { smtpConfig } from "@/db/schema";
import type { Database } from "@/db/connection";
import type { ISmtpConfigRepository, SmtpConfigInput, SmtpConfigUpdateInput, SmtpConfigRecord } from "./smtp-config.types";
import { eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";

export class SmtpConfigRepository implements ISmtpConfigRepository {
  constructor(private readonly db: Database) {}

  async create(userId: string, input: SmtpConfigInput): Promise<SmtpConfigRecord> {
    const id = createId();
    await this.db
      .insert(smtpConfig)
      .values({
        id,
        userId,
        smtpHostname: input.smtpHostname,
        smtpPort: input.smtpPort,
        smtpSecurity: input.smtpSecurity,
        smtpUsername: input.smtpUsername,
        smtpPassword: input.smtpPassword,
        senderEmail: input.senderEmail,
      });

    const result = await this.findById(id);
    return result!;
  }

  async findByUserId(userId: string): Promise<SmtpConfigRecord[]> {
    const results = await this.db
      .select()
      .from(smtpConfig)
      .where(eq(smtpConfig.userId, userId));

    return results.map(this.toRecord);
  }

  async findAll(): Promise<SmtpConfigRecord[]> {
    const results = await this.db.select().from(smtpConfig);
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
    await this.db
      .update(smtpConfig)
      .set(input)
      .where(eq(smtpConfig.id, id));

    const result = await this.findById(id);
    return result!;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(smtpConfig).where(eq(smtpConfig.id, id));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toRecord(row: any): SmtpConfigRecord {
    return {
      id: row.id,
      userId: row.userId,
      smtpHostname: row.smtpHostname,
      smtpPort: row.smtpPort,
      smtpSecurity: row.smtpSecurity,
      smtpUsername: row.smtpUsername,
      smtpPassword: row.smtpPassword,
      senderEmail: row.senderEmail,
      isActive: row.isActive,
      lastCheckAt: row.lastCheckAt,
      lastCheckOk: row.lastCheckOk,
      lastCheckError: row.lastCheckError,
      bounceWebhookProvider: row.bounceWebhookProvider ?? null,
      bounceWebhookSecret: row.bounceWebhookSecret ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
