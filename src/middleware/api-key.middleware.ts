import { createMiddleware } from "hono/factory";

// TODO: to be implemented
export function apiKeyMiddleware(_apiKey: string) {
  return createMiddleware(async (_c, next) => {
    await next();
  });
}
