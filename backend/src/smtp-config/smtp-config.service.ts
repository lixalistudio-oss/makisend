import { encrypt } from "@/core/crypto";
import { AppError } from "@/core/errors";
import { pinoLogger } from "@/core/logger";
import type { ISmtpConfigRepository, SmtpConfigRecord } from "./smtp-config.types";

export class SmtpConfigService {
  constructor(
    private readonly smtpConfigRepo: ISmtpConfigRepository,
    private readonly aesKey: string,
  ) {}

  async findAllByUser(userId: string): Promise<SmtpConfigRecord[]> {
    pinoLogger.info({ userId }, "Fetching all SMTP configs for user");
    return this.smtpConfigRepo.findByUserId(userId);
  }

  async findByIdAndUser(id: string, userId: string): Promise<SmtpConfigRecord> {
    pinoLogger.info({ id, userId }, "Fetching SMTP config by ID");
    const config = await this.smtpConfigRepo.findById(id);
    if (!config) {
      throw new AppError(404, "SMTP config not found");
    }
    if (config.userId !== userId) {
      throw new AppError(403, "Not authorized to access this SMTP config");
    }
    return config;
  }

  async create(
    userId: string,
    input: { smtpHostname: string; smtpUsername: string; smtpPassword: string; senderEmail: string },
  ): Promise<SmtpConfigRecord> {
    pinoLogger.info({ userId, senderEmail: input.senderEmail }, "Creating SMTP config");

    const [encryptedHostname, encryptedUsername, encryptedPassword, encryptedSenderEmail] =
      await Promise.all([
        encrypt(input.smtpHostname, this.aesKey),
        encrypt(input.smtpUsername, this.aesKey),
        encrypt(input.smtpPassword, this.aesKey),
        encrypt(input.senderEmail, this.aesKey),
      ]);

    const config = await this.smtpConfigRepo.create(userId, {
      smtpHostname: encryptedHostname,
      smtpUsername: encryptedUsername,
      smtpPassword: encryptedPassword,
      senderEmail: encryptedSenderEmail,
    });

    pinoLogger.info({ configId: config.id }, "SMTP config created successfully");
    return config;
  }

  async update(
    id: string,
    userId: string,
    updates: { smtpHostname?: string; smtpUsername?: string; smtpPassword?: string; senderEmail?: string; isActive?: boolean },
  ): Promise<SmtpConfigRecord> {
    pinoLogger.info({ id, userId }, "Updating SMTP config");

    const existing = await this.smtpConfigRepo.findById(id);
    if (!existing) {
      throw new AppError(404, "SMTP config not found");
    }
    if (existing.userId !== userId) {
      throw new AppError(403, "Not authorized to update this SMTP config");
    }

    const encryptedUpdates: Record<string, string | boolean> = {};

    if (updates.smtpHostname) {
      encryptedUpdates.smtpHostname = await encrypt(updates.smtpHostname, this.aesKey);
    }
    if (updates.smtpUsername) {
      encryptedUpdates.smtpUsername = await encrypt(updates.smtpUsername, this.aesKey);
    }
    if (updates.smtpPassword) {
      encryptedUpdates.smtpPassword = await encrypt(updates.smtpPassword, this.aesKey);
    }
    if (updates.senderEmail) {
      encryptedUpdates.senderEmail = await encrypt(updates.senderEmail, this.aesKey);
    }
    if (updates.isActive !== undefined) {
      encryptedUpdates.isActive = updates.isActive;
    }

    const config = await this.smtpConfigRepo.update(id, encryptedUpdates);
    pinoLogger.info({ id }, "SMTP config updated successfully");
    return config;
  }

  async delete(id: string, userId: string): Promise<void> {
    pinoLogger.info({ id, userId }, "Deleting SMTP config");

    const existing = await this.smtpConfigRepo.findById(id);
    if (!existing) {
      throw new AppError(404, "SMTP config not found");
    }
    if (existing.userId !== userId) {
      throw new AppError(403, "Not authorized to delete this SMTP config");
    }

    await this.smtpConfigRepo.delete(id);
    pinoLogger.info({ id }, "SMTP config deleted successfully");
  }
}
