import { createMiddleware } from "hono/factory";

// TODO: Will be replaced by Better Auth version after merge to dev
export function apiKeyMiddleware() {
  return createMiddleware(async (c, next) => {
    await next();
  });
}
