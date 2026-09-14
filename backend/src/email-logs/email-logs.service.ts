import { pinoLogger } from "@/core/logger";
import type { IEmailLogRepository, EmailLogFilters, EmailLogWithHistory } from "./email-logs.types";

export class EmailLogService {
  constructor(private readonly emailLogRepo: IEmailLogRepository) {}

  async findAllByUser(userId: string, filters?: EmailLogFilters): Promise<EmailLogWithHistory[]> {
    pinoLogger.info({ userId, filters }, "Fetching email logs for user");
    return this.emailLogRepo.findByUserId(userId, filters);
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
    return log;
  }
}
