import { encrypt, decrypt } from "@/core/crypto";
import { AppError } from "@/core/errors";
import { pinoLogger } from "@/core/logger";
import type { ISmtpConfigRepository, SmtpConfigRecord } from "./smtp-config.types";
import { defaultSecurityFor, type SmtpSecurity } from "./smtp-host";
import {
  checkSmtpConnection,
  sendTestEmail,
  type SmtpCheckResult,
  type SmtpSendResult,
  type TestEmail,
} from "./smtp-connection";

export class SmtpConfigService {
  constructor(
    private readonly smtpConfigRepo: ISmtpConfigRepository,
    private readonly aesKey: string,
  ) {}

  private async decryptRecord(record: SmtpConfigRecord): Promise<SmtpConfigRecord> {
    const [smtpHostname, smtpUsername, smtpPassword, senderEmail] = await Promise.all([
      decrypt(record.smtpHostname, this.aesKey),
      decrypt(record.smtpUsername, this.aesKey),
      decrypt(record.smtpPassword, this.aesKey),
      decrypt(record.senderEmail, this.aesKey),
    ]);
    return { ...record, smtpHostname, smtpUsername, smtpPassword, senderEmail };
  }

  async findAllByUser(userId: string): Promise<SmtpConfigRecord[]> {
    pinoLogger.info({ userId }, "Fetching all SMTP configs for user");
    const records = await this.smtpConfigRepo.findByUserId(userId);
    return Promise.all(records.map((r) => this.decryptRecord(r)));
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
    return this.decryptRecord(config);
  }

  async create(
    userId: string,
    input: {
      smtpHostname: string;
      smtpPort: number;
      smtpSecurity: SmtpSecurity;
      smtpUsername: string;
      smtpPassword: string;
      senderEmail: string;
    },
  ): Promise<SmtpConfigRecord> {
    pinoLogger.info(
      { userId, senderEmail: input.senderEmail, smtpPort: input.smtpPort, smtpSecurity: input.smtpSecurity },
      "Creating SMTP config",
    );

    const [encryptedHostname, encryptedUsername, encryptedPassword, encryptedSenderEmail] =
      await Promise.all([
        encrypt(input.smtpHostname, this.aesKey),
        encrypt(input.smtpUsername, this.aesKey),
        encrypt(input.smtpPassword, this.aesKey),
        encrypt(input.senderEmail, this.aesKey),
      ]);

    const config = await this.smtpConfigRepo.create(userId, {
      smtpHostname: encryptedHostname,
      smtpPort: input.smtpPort,
      smtpSecurity: input.smtpSecurity,
      smtpUsername: encryptedUsername,
      smtpPassword: encryptedPassword,
      senderEmail: encryptedSenderEmail,
    });

    pinoLogger.info({ configId: config.id }, "SMTP config created successfully");
    return this.decryptRecord(config);
  }

  async update(
    id: string,
    userId: string,
    updates: {
      smtpHostname?: string;
      smtpPort?: number;
      smtpSecurity?: SmtpSecurity;
      smtpUsername?: string;
      smtpPassword?: string;
      senderEmail?: string;
      isActive?: boolean;
    },
  ): Promise<SmtpConfigRecord> {
    pinoLogger.info({ id, userId }, "Updating SMTP config");

    const existing = await this.smtpConfigRepo.findById(id);
    if (!existing) {
      throw new AppError(404, "SMTP config not found");
    }
    if (existing.userId !== userId) {
      throw new AppError(403, "Not authorized to update this SMTP config");
    }

    const encryptedUpdates: Record<string, string | number | boolean> = {};

    // A new port without an explicit security takes that port's usual mode, so
    // changing 465 to 587 cannot leave an implicit-TLS row on a STARTTLS port.
    if (updates.smtpPort !== undefined) {
      encryptedUpdates.smtpPort = updates.smtpPort;
      encryptedUpdates.smtpSecurity = updates.smtpSecurity ?? defaultSecurityFor(updates.smtpPort);
    } else if (updates.smtpSecurity !== undefined) {
      encryptedUpdates.smtpSecurity = updates.smtpSecurity;
    }

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
    return this.decryptRecord(config);
  }


  async checkConnection(input: {
    smtpHostname: string;
    smtpPort: number;
    smtpSecurity: SmtpSecurity;
    smtpUsername: string;
    smtpPassword: string;
  }): Promise<SmtpCheckResult> {
    return checkSmtpConnection({
      smtpHostName: input.smtpHostname,
      smtpPort: input.smtpPort,
      smtpSecurity: input.smtpSecurity,
      smtpUsername: input.smtpUsername,
      smtpPassword: input.smtpPassword,
    });
  }

  async checkConnectionById(id: string, userId: string): Promise<SmtpCheckResult> {
    const config = await this.findByIdAndUser(id, userId);
    return checkSmtpConnection(this.toTransportConfig(config));
  }

  async sendTest(id: string, userId: string, email: TestEmail): Promise<SmtpSendResult> {
    const config = await this.findByIdAndUser(id, userId);
    return sendTestEmail(this.toTransportConfig(config), email);
  }

  async checkAll(): Promise<{ checked: number; healthy: number }> {
    const records = await this.smtpConfigRepo.findAll();
    let healthy = 0;

    for (const record of records) {
      let result: SmtpCheckResult;
      try {
        const decrypted = await this.decryptRecord(record);
        result = await checkSmtpConnection(this.toTransportConfig(decrypted));
      } catch (err) {
        pinoLogger.error({ err, configId: record.id }, "SMTP health check could not read the configuration");
        result = {
          ok: false,
          reason: "unknown",
          message: "The stored SMTP configuration could not be read.",
        };
      }

      if (result.ok) healthy++;

      try {
        await this.smtpConfigRepo.update(record.id, {
          lastCheckAt: new Date(),
          lastCheckOk: result.ok,
          lastCheckError: result.ok ? null : result.message,
        });
      } catch (err) {
        pinoLogger.error({ err, configId: record.id }, "SMTP health check result could not be stored");
      }
    }

    return { checked: records.length, healthy };
  }

  private toTransportConfig(config: SmtpConfigRecord) {
    return {
      smtpHostName: config.smtpHostname,
      smtpPort: config.smtpPort,
      smtpSecurity: config.smtpSecurity,
      smtpUsername: config.smtpUsername,
      smtpPassword: config.smtpPassword,
      senderEmail: config.senderEmail,
    };
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
