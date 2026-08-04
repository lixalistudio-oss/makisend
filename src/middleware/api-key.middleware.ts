import { createMiddleware } from "hono/factory";
import { pinoLogger } from "@/core/logger";
import { Config } from "@/config/config";
import { AppError } from "@/core/errors";
import { createDatabase } from "@/db/connection";
import { apikey } from "@/db/schema";
import { eq } from "drizzle-orm";

export function apiKeyMiddleware(config: Config) {
  return createMiddleware(async (c, next) => {
    const authHeader = c.req.header("Authorization");

    // Expect: "Bmk.xxxx-xxxx-xxxx"
    if (!authHeader?.startsWith("mk.")) {
      pinoLogger.error({ err: Error }, "Missing or invalid Authorization header");
      throw new AppError(401, "Email delivery failed");
    }
    const db = createDatabase(config.db);
    const result = await db
      .select()
      .from(apikey)
      .where(eq(apikey.key, authHeader))
      .limit(1);

    const apiKeyRecord = result[0];

    if (!apiKeyRecord) {
      return c.json({ error: "Invalid API key" }, 403);
    }

    // Attach user/key info to context for downstream handlers
    c.set("apiKey", apiKeyRecord.key);
    c.set("userId", apiKeyRecord.referenceId);

    await next();
  });
}