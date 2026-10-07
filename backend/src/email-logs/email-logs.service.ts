import { decrypt } from "@/core/crypto";
import { pinoLogger } from "@/core/logger";
import type { IEmailLogRepository, EmailLogFilters, EmailLogWithHistory } from "./email-logs.types";

export class EmailLogService {
  constructor(
    private readonly emailLogRepo: IEmailLogRepository,
    private readonly aesKey: string,
  ) {}

  async findAllByUser(userId: string, filters?: EmailLogFilters): Promise<EmailLogWithHistory[]> {
    pinoLogger.info({ userId, filters }, "Fetching email logs for user");
    let logs = await this.emailLogRepo.findByUserId(userId, filters);
    logs = await Promise.all(logs.map((log) => this.decryptLog(log)));

    if (filters?.to) {
      logs = logs.filter((log) => log.to.toLowerCase().includes(filters.to!.toLowerCase()));
    }

    return logs;
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
