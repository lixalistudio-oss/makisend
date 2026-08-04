import { createMiddleware } from "hono/factory";
import { pinoLogger } from "@/core/logger";
import { Config } from "@/config/config";
import { AppError } from "@/core/errors";
import { createDatabase } from "@/db/connection";
import { apikey } from "@/db/schema";
import { eq } from "drizzle-orm";


// src/types/hono.d.ts (or any .d.ts file)
declare module "hono" {
  interface ContextVariableMap {
    userId: string;
    apiKey: string;
  }
}
export function apiKeyMiddleware(config: Config) {
  return createMiddleware(async (c, next) => {
    const authHeader = c.req.header("Authorization");

    // Expect: "mk.xxxx-xxxx-xxxx"
    if (!authHeader?.startsWith("mk.")) {
      pinoLogger.error({ err: Error }, "Missing or invalid Authorization header");
      throw new AppError(401, "Missing or invalid Authorization header");
    }
    const db = createDatabase(config.db);
    const result = await db
      .select()
      .from(apikey)
      .where(eq(apikey.key, authHeader))
      .limit(1);

    const apiKeyRecord = result[0];

    if (!apiKeyRecord) {
      pinoLogger.error({ err: Error }, "Invalid API Key");
      throw new AppError(403, "Invalid API Key");
    }

    // Attach user/key info to context for downstream handlers
    c.set("apiKey", apiKeyRecord.key);
    c.set("userId", apiKeyRecord.referenceId);

    await next();
  });
}