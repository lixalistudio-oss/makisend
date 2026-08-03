import type { Config } from "@/config/config";
import { createDatabase } from "@/db/connection";
import { SmtpEmailTransport } from "@/transports";
import { SendEmailService } from "./send-email.service";
import { SendEmailRepository } from "./send-email.repository";

export function createSendEmailModule(config: Config) {
  const db = createDatabase(config.db);
  const transport = new SmtpEmailTransport(config.smtp, config.senderEmail);
  const repository = new SendEmailRepository(db);
  const service = new SendEmailService(transport, repository, config.aesKey);

  return {
    service,
    repository,
    transport,
  };
}
