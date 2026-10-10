import { eq } from "drizzle-orm";
import { smtpConfig as smtpConfigTable } from "@/db/schema";
import { decrypt } from "@/core/crypto";
import { AppError } from "@/core/errors";
import { pinoLogger } from "@/core/logger";
import { createDatabase } from "@/db/connection";
import { SmtpEmailTransport } from "./index";
import type { Config, SmtpConfig } from "@/config/config";
import type { IEmailTransport } from "./send-email.types";
import type { Bindings } from "@/index";

export function buildTransportConfig(env: Bindings): Config {
  return {
    port: env.PORT,
    aesKey: env.AES_256_KEY,
    db: env.makisend_db,
    inngestConfig: env.INNGEST_DEV,
    better_auth_secret: env.BETTER_AUTH_SECRET,
    better_auth_url: env.BETTER_AUTH_URL,
  };
}

type SmtpConfigRow = typeof smtpConfigTable.$inferSelect;

/**
 * Look up an SMTP configuration. With `smtpConfigId` the exact row the event was
 * queued with is used; without it (legacy events) the active configuration — or
 * any configuration — is used as a fallback.
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
    return byId;
  }

  const [active] = await db
    .select()
    .from(smtpConfigTable)
    .where(eq(smtpConfigTable.isActive, true))
    .limit(1);
  return active ?? (await db.select().from(smtpConfigTable).limit(1))[0];
}

export async function decryptSmtpRecord(
  env: Bindings,
  record: SmtpConfigRow,
): Promise<SmtpConfig> {
  const [smtpHostName, smtpUsername, smtpPassword, senderEmail] = await Promise.all([
    decrypt(record.smtpHostname, env.AES_256_KEY),
    decrypt(record.smtpUsername, env.AES_256_KEY),
    decrypt(record.smtpPassword, env.AES_256_KEY),
    decrypt(record.senderEmail, env.AES_256_KEY),
  ]);
  return { smtpHostName, smtpUsername, smtpPassword, senderEmail };
}

/**
 * Inngest callbacks (`/api/inngest`) arrive without an API key, so they never get
 * `smtpConfig` from the context. Without a fallback the isolate that runs the
 * send-email function would receive `transport === null` and crash with
 * "Cannot read properties of null (reading 'send')". Load the active SMTP
 * configuration from the database instead.
 */
export async function loadActiveSmtpConfig(env: Bindings): Promise<SmtpConfig | undefined> {
  try {
    const record = await findSmtpRecord(env);
    return record ? await decryptSmtpRecord(env, record) : undefined;
  } catch (err) {
    pinoLogger.error({ err }, "Failed to load SMTP configuration for the transport");
    return undefined;
  }
}

/**
 * Transport factory injected into the Inngest send-email function. It builds a
 * fresh nodemailer transport from the configuration referenced by the event, so
 * credential edits apply immediately and each tenant sends with its own SMTP
 * account instead of a per-isolate singleton.
 */
export async function resolveTransportFor(
  env: Bindings,
  smtpConfigId?: string,
): Promise<IEmailTransport> {
  let record: SmtpConfigRow | undefined;
  try {
    record = await findSmtpRecord(env, smtpConfigId);
  } catch (err) {
    pinoLogger.error({ err, smtpConfigId }, "Failed to look up SMTP configuration");
    throw new AppError(500, "Failed to look up SMTP configuration");
  }

  if (!record) {
    pinoLogger.error({ smtpConfigId }, "SMTP configuration for this event was not found");
    throw new AppError(404, "SMTP configuration not found");
  }

  const smtpConfig = await decryptSmtpRecord(env, record);
  return new SmtpEmailTransport(buildTransportConfig(env), smtpConfig);
}
