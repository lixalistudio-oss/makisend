import { decrypt } from "@/core/crypto";
import { pinoLogger } from "@/core/logger";
import type {
  IEmailLogRepository,
  EmailLogPageFilters,
  EmailLogPage,
  EmailLogWithHistory,
} from "./email-logs.types";

export class EmailLogService {
  constructor(
    private readonly emailLogRepo: IEmailLogRepository,
    private readonly aesKey: string,
  ) {}

  async findPageByUser(userId: string, filters?: EmailLogPageFilters): Promise<EmailLogPage> {
    pinoLogger.info({ userId, filters }, "Fetching email logs page for user");
    const { logs, nextCursor } = await this.emailLogRepo.findPageByUserId(userId, filters);

    let decrypted = await Promise.all(logs.map((log) => this.decryptLog(log)));

    // `to` is stored AES-encrypted, so substring matching can only happen after
    // decryption — it applies to the fetched page, not the whole table.
    if (filters?.to) {
      decrypted = decrypted.filter((log) => log.to.toLowerCase().includes(filters.to!.toLowerCase()));
    }

    return { logs: decrypted, nextCursor };
  }

  async findById(id: string, userId: string): Promise<EmailLogWithHistory> {
    pinoLogger.info({ id, userId }, "Fetching email log by ID");
    const log = await this.emailLogRepo.findById(id);
    if (!log) {
      throw new Error("Email log not found");
    }
    if (log.userId !== userId) {
      throw new Error("Not authorized to access this email log");
    }
    return this.decryptLog(log);
  }

  private async decryptLog(log: EmailLogWithHistory): Promise<EmailLogWithHistory> {
    const to = await decrypt(log.to, this.aesKey);
    return { ...log, to };
  }
}
