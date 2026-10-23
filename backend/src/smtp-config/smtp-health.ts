import { resolveEncryptionKeys } from "@/config/config";
import { pinoLogger } from "@/core/logger";
import { createDatabase } from "@/db/connection";
import { SmtpConfigRepository } from "./smtp-config.repository";
import { SmtpConfigService } from "./smtp-config.service";
import type { Bindings } from "@/index";

export async function runSmtpHealthChecks(env: Bindings) {
  const repository = new SmtpConfigRepository(createDatabase(env.makisend_db));
  const service = new SmtpConfigService(repository, resolveEncryptionKeys(env), { emailBinding: env.EMAIL });
  const result = await service.checkAll();
  pinoLogger.info(result, "Scheduled SMTP health check finished");
  return result;
}
