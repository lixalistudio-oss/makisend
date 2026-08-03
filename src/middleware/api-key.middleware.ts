import { createMiddleware } from "hono/factory";
import { AppError } from "@/core/errors";

export function apiKeyMiddleware(apiKey: string) {
  return createMiddleware(async (c, next) => {
    const providedKey = c.req.header("x-makisend-key")?.trim();

    if (!providedKey || providedKey !== apiKey) {
      throw new AppError(401, "Unauthorized: invalid or missing API key");
    }

    await next();
  });
}
