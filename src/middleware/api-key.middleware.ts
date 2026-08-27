import { createMiddleware } from "hono/factory";
import { pinoLogger } from "@/core/logger";
import type { Config } from "@/config/config";
import { AppError } from "@/core/errors";
import { createDatabase } from "@/db/connection";
import { user } from "@/db/schema";
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
    const userResult = await db
      .select({
        id: user.id,
        smtpUsername: user.smtpUsername,
        smtpPassword: user.smtpPassword,
        smtpHostName: user.smtpHostName,
        senderEmail: user.senderEmail,
      })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);

    const userRecord = userResult[0];
    if (!userRecord) {
      pinoLogger.error("User not found for this API key");
      throw new AppError(403, "User not found");
    }

    // Decrypt SMTP credentials
    const [
      decryptedSmtpUsername,
      decryptedSmtpPassword,
      decryptedSmtpHostName,
      decryptedSenderEmail,
    ] = await Promise.all([
      decrypt(userRecord.smtpUsername, config.aesKey),
      decrypt(userRecord.smtpPassword, config.aesKey),
      decrypt(userRecord.smtpHostName, config.aesKey),
      decrypt(userRecord.senderEmail, config.aesKey),
    ]);

    c.set("smtpConfig", {
      smtpUsername: decryptedSmtpUsername,
      smtpPassword: decryptedSmtpPassword,
      smtpHostName: decryptedSmtpHostName,
      senderEmail: decryptedSenderEmail,
    });
    c.set("userConfig", { userId: userRecord.id });

    await next();
  });
}
