import { eq } from "drizzle-orm";
import { smtpConfig as smtpConfigTable } from "@/db/schema";
import { decrypt } from "@/core/crypto";
import { AppError } from "@/core/errors";
import { pinoLogger } from "@/core/logger";
import { createDatabase } from "@/db/connection";
import { SmtpEmailTransport } from "@/transports";
import { CloudflareEmailTransport } from "./cloudflare-email.transport";
import { isCloudflareEmailHost } from "@/smtp-config/smtp-host";
import type { SmtpConfig } from "@/config/config";
import { resolveEncryptionKeys } from "@/config/config";
import type { IEmailTransport } from "./send-email.types";
import type { Bindings } from "@/index";

type SmtpConfigRow = typeof smtpConfigTable.$inferSelect;

/**
 * With an explicit id, use exactly that row and refuse it when disabled.
 * Without one, use an active configuration.
 */
export async function findSmtpRecord(
  env: Bindings,
  smtpConfigId?: string,
): Promise<SmtpConfigRow | undefined> {
  const db = createDatabase(env.makisend_db);

  if (smtpConfigId) {
    const [byId] = await db
      .select()
      .from(smtpConfigTable)
      .where(eq(smtpConfigTable.id, smtpConfigId))
      .limit(1);
    if (byId && !byId.isActive) {
      throw new AppError(409, "SMTP configuration is inactive");
    }
    return byId;
  }

  const [active] = await db
    .select()
    .from(smtpConfigTable)
    .where(eq(smtpConfigTable.isActive, true))
    .limit(1);
  return active;
}

export async function decryptSmtpRecord(
  env: Bindings,
  record: SmtpConfigRow,
): Promise<SmtpConfig> {
  const [smtpHostName, smtpUsername, smtpPassword, senderEmail] = await Promise.all([
    decrypt(record.smtpHostname, resolveEncryptionKeys(env)),
    decrypt(record.smtpUsername, resolveEncryptionKeys(env)),
    decrypt(record.smtpPassword, resolveEncryptionKeys(env)),
    decrypt(record.senderEmail, resolveEncryptionKeys(env)),
  ]);
  return {
    smtpHostName,
    smtpPort: record.smtpPort,
    smtpSecurity: record.smtpSecurity,
    smtpUsername,
    smtpPassword,
    senderEmail,
  };
}

/**
 * Builds a fresh transport for the configuration selected at enqueue time, so
 * credential edits apply immediately and tenants never share an SMTP account.
 */
export async function resolveTransportFor(
  env: Bindings,
  smtpConfigId?: string,
): Promise<IEmailTransport> {
  let record: SmtpConfigRow | undefined;
  try {
    record = await findSmtpRecord(env, smtpConfigId);
  } catch (err) {
    if (err instanceof AppError) throw err;
    pinoLogger.error({ err, smtpConfigId }, "Failed to look up SMTP configuration");
    throw new AppError(500, "Failed to look up SMTP configuration");
  }

  if (!record) {
    pinoLogger.error({ smtpConfigId }, "SMTP configuration for this event was not found");
    throw new AppError(404, "SMTP configuration not found");
  }

  const smtpConfig = await decryptSmtpRecord(env, record);
  // A Worker cannot open a socket to Cloudflare Email Service: it goes through the send_email binding.
  if (isCloudflareEmailHost(smtpConfig.smtpHostName)) {
    return new CloudflareEmailTransport(env.EMAIL, smtpConfig.senderEmail);
  }
  return new SmtpEmailTransport(smtpConfig);
}
