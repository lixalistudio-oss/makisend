import { createMiddleware } from "hono/factory";
import { AppError } from "@/core/errors";

export function apiKeyMiddleware(apiKey: string) {
  return createMiddleware(async (c, next) => {
    const header = c.req.header("x-api-key") ?? c.req.header("authorization");
    const providedKey = header?.replace(/^Bearer\s+/i, "").trim();

    if (!providedKey || providedKey !== apiKey) {
      throw new AppError(401, "Unauthorized: invalid or missing API key");
    }

    await next();
  });
}
