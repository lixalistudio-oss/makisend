import { createMiddleware } from "hono/factory";

export function apiKeyMiddleware() {
  return createMiddleware(async (c, next) => {
    await next();
  });
}
