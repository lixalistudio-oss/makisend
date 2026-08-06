import { createMiddleware } from "hono/factory";
import { pinoLogger } from "@/core/logger";
import type { Config, SmtpConfig, UserConfig } from "@/config/config";
import { AppError } from "@/core/errors";
import { createDatabase } from "@/db/connection";
import { apikey,user } from "@/db/schema";
import { eq } from "drizzle-orm";
import { decrypt } from "@/core/crypto";

// src/types/hono.d.ts (or any .d.ts file)
declare module "hono" {
  interface ContextVariableMap {
    smtpConfig: SmtpConfig,
    userConfig: UserConfig
  }
}
export function apiKeyMiddleware(config: Config) {
  return createMiddleware(async (c, next) => {
   
    const apiKeyHeader = c.req.header("x-api-key");
    const authHeader = c.req.header("Authorization");

    let apiKey: string | undefined;

    if (apiKeyHeader) {
     apiKey = apiKeyHeader;
}   else if (authHeader?.startsWith("Bearer ")) {
     apiKey = authHeader.replace("Bearer ", "");
}

    
    if (!apiKey) {
      pinoLogger.error({ err: Error }, "Missing x-api-key or Authorization header");
      throw new AppError(401, "Missing x-api-key or Authorization header");
    }
    // Expect: "mk.xxxx-xxxx-xxxx"
    if (!apiKey.startsWith("mk.")) {
      pinoLogger.error({ err: Error }, "Invalid x-api-key or Authorization header");
      throw new AppError(401, "Invalid x-api-key or Authorization header");
    }
    const db = createDatabase(config.db);
    const result = await db
    .select({
    // User fields
    userId: user.id,
    smtpUsername : user.smtpUsername,
    smtpPassword : user.smtpPassword,
    smtpHostName : user.smtpHostName,
    senderEmail : user.senderEmail
  })
    .from(apikey)
    .innerJoin(user, eq(user.id, apikey.referenceId))
    .where(eq(apikey.key, apiKey))
    .limit(1);
    
    const apiKeyRecord = result[0];
    if (!apiKeyRecord) {
      pinoLogger.error({ err: Error }, "Invalid API Key");
      throw new AppError(403, "Invalid API Key");
    }
    //Decrypt all sensitive infos about the user
    const [
        decryptedSmtpUsername,
        decryptedSmtpPassword,
        decryptedSmtpHostName,
        decryptedSenderEmail,
    ] = await Promise.all([
        decrypt(apiKeyRecord.smtpUsername,config.aesKey),
        decrypt(apiKeyRecord.smtpPassword,config.aesKey),
        decrypt(apiKeyRecord.smtpHostName,config.aesKey),
        decrypt(apiKeyRecord.senderEmail,config.aesKey),
    ]);

    // Attach user/key info to context for downstream handlers
    // c.set("apiKey", apiKeyRecord.key);
    c.set("smtpConfig", {
      smtpUsername: decryptedSmtpUsername,
      smtpPassword: decryptedSmtpPassword,
      smtpHostName: decryptedSmtpHostName,
      senderEmail: decryptedSenderEmail,
});
    c.set("userConfig",{userId : apiKeyRecord.userId})
    await next();
  });
}