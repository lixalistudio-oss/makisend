import { createMiddleware } from "hono/factory";
import { pinoLogger } from "@/core/logger";
import type { Config } from "@/config/config";
import { AppError } from "@/core/errors";
import { createDatabase } from "@/db/connection";
import { user, apikey, smtpConfig } from "@/db/schema";
import { eq } from "drizzle-orm";
import { decrypt } from "@/core/crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function apiKeyMiddleware(config: Config, auth: any) {
  return createMiddleware(async (c, next) => {
    const apiKeyHeader = c.req.header("x-api-key");
    const authHeader = c.req.header("Authorization");

    let apiKey: string | undefined;

    if (apiKeyHeader) {
      apiKey = apiKeyHeader;
    } else if (authHeader?.startsWith("Bearer ")) {
      apiKey = authHeader.replace("Bearer ", "");
    }

    if (!apiKey) {
      pinoLogger.error("Missing x-api-key or Authorization header");
      throw new AppError(401, "Missing x-api-key or Authorization header");
    }

    // Verify API key with Better Auth
    const result = await auth.api.verifyApiKey({
      body: { key: apiKey },
    });

    if (!result.valid || !result.key) {
      pinoLogger.error("Invalid API Key");
      throw new AppError(403, "Invalid API Key");
    }

    // referenceId = the user ID who owns this API key
    const userId = result.key.referenceId;

    const db = createDatabase(config.db);

    // Verify user exists
    const userResult = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);

    if (!userResult[0]) {
      pinoLogger.error("User not found for this API key");
      throw new AppError(403, "User not found");
    }

    // Look up the API key record to get the linked smtp_config_id
    const apiKeyRecord = await db
      .select({ smtpConfigId: apikey.smtpConfigId })
      .from(apikey)
      .where(eq(apikey.id, result.key.id))
      .limit(1);

    if (!apiKeyRecord[0]?.smtpConfigId) {
      pinoLogger.error("API key is not linked to an SMTP configuration");
      throw new AppError(403, "API key has no SMTP configuration");
    }

    // Fetch the SMTP config
    const smtpConfigResult = await db
      .select()
      .from(smtpConfig)
      .where(eq(smtpConfig.id, apiKeyRecord[0].smtpConfigId))
      .limit(1);

    if (!smtpConfigResult[0]) {
      pinoLogger.error("SMTP configuration not found");
      throw new AppError(403, "SMTP configuration not found");
    }

    const record = smtpConfigResult[0];

    // Decrypt SMTP credentials
    const [
      decryptedSmtpUsername,
      decryptedSmtpPassword,
      decryptedSmtpHostName,
      decryptedSenderEmail,
    ] = await Promise.all([
      decrypt(record.smtpUsername, config.aesKey),
      decrypt(record.smtpPassword, config.aesKey),
      decrypt(record.smtpHostname, config.aesKey),
      decrypt(record.senderEmail, config.aesKey),
    ]);

    c.set("smtpConfig", {
      smtpUsername: decryptedSmtpUsername,
      smtpPassword: decryptedSmtpPassword,
      smtpHostName: decryptedSmtpHostName,
      senderEmail: decryptedSenderEmail,
    });
    c.set("userConfig", { userId: userResult[0].id });

    await next();
  });
}
