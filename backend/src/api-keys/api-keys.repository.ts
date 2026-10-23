import { apikey, smtpConfig } from "@/db/schema";
import type { Database } from "@/db/connection";
import type { IApiKeyRepository, ApiKeyCreateInput, ApiKeyRecord, ApiKeyCreatedResult } from "./api-keys.types";
import { eq, and, desc } from "drizzle-orm";

export class ApiKeyRepository implements IApiKeyRepository {
  constructor(
    private readonly db: Database,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly auth: any,
  ) {}

  async create(userId: string, input: ApiKeyCreateInput): Promise<ApiKeyCreatedResult> {
    // Verify user owns the SMTP config
    const config = await this.db
      .select({ id: smtpConfig.id })
      .from(smtpConfig)
      .where(
        and(
          eq(smtpConfig.id, input.smtpConfigId),
          eq(smtpConfig.userId, userId),
        ),
      )
      .limit(1);

    if (!config[0]) {
      throw new Error("SMTP config not found or not owned by user");
    }

    // Create API key via Better Auth
    const result = await this.auth.api.createApiKey({
      body: {
        userId,
        name: input.name || "API Key",
        prefix: "mk_",
      },
    });

    if (!result.key) {
      throw new Error("Failed to create API key");
    }

    // Find the most recently created key for this user
    const latestKey = await this.db
      .select()
      .from(apikey)
      .where(eq(apikey.referenceId, userId))
      .orderBy(desc(apikey.createdAt))
      .limit(1);

    if (!latestKey[0]) {
      throw new Error("Failed to find created API key");
    }

    // Link API key to SMTP config
    await this.db
      .update(apikey)
      .set({ smtpConfigId: input.smtpConfigId })
      .where(eq(apikey.id, latestKey[0].id));

    return {
      key: result.key as string,
      record: this.toRecord({ ...latestKey[0], smtpConfigId: input.smtpConfigId }),
    };
  }

  async findByUserId(userId: string): Promise<ApiKeyRecord[]> {
    const results = await this.db
      .select()
      .from(apikey)
      .where(eq(apikey.referenceId, userId))
      .orderBy(desc(apikey.createdAt));

    return results.map(this.toRecord);
  }

  async findById(id: string): Promise<ApiKeyRecord | null> {
    const result = await this.db
      .select()
      .from(apikey)
      .where(eq(apikey.id, id))
      .limit(1);

    return result[0] ? this.toRecord(result[0]) : null;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(apikey).where(eq(apikey.id, id));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toRecord(row: any): ApiKeyRecord {
    return {
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      start: row.start,
      enabled: row.enabled,
      smtpConfigId: row.smtpConfigId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
