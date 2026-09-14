import { AppError } from "@/core/errors";
import { pinoLogger } from "@/core/logger";
import type { IApiKeyRepository, ApiKeyCreateInput, ApiKeyRecord, ApiKeyCreatedResult } from "./api-keys.types";

export class ApiKeyService {
  constructor(private readonly apiKeyRepo: IApiKeyRepository) {}

  async findAllByUser(userId: string): Promise<ApiKeyRecord[]> {
    pinoLogger.info({ userId }, "Fetching all API keys for user");
    return this.apiKeyRepo.findByUserId(userId);
  }

  async findById(id: string): Promise<ApiKeyRecord | null> {
    return this.apiKeyRepo.findById(id);
  }

  async create(userId: string, input: ApiKeyCreateInput): Promise<ApiKeyCreatedResult> {
    pinoLogger.info({ userId, smtpConfigId: input.smtpConfigId }, "Creating API key");
    const result = await this.apiKeyRepo.create(userId, input);
    pinoLogger.info({ apiKeyId: result.record.id }, "API key created successfully");
    return result;
  }

  async delete(id: string, userId: string): Promise<void> {
    pinoLogger.info({ id, userId }, "Deleting API key");

    const existing = await this.apiKeyRepo.findById(id);
    if (!existing) {
      throw new AppError(404, "API key not found");
    }

    // Verify ownership
    const userKeys = await this.apiKeyRepo.findByUserId(userId);
    const ownsKey = userKeys.some((k) => k.id === id);
    if (!ownsKey) {
      throw new AppError(403, "Not authorized to delete this API key");
    }

    await this.apiKeyRepo.delete(id);
    pinoLogger.info({ id }, "API key deleted successfully");
  }
}
