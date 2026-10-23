import type { MiddlewareHandler } from "hono";
import { pinoLogger } from "@/core/logger";
import type { Bindings, UserInfoVariables } from "@/index";
import type { ISendRateLimitRepository, SendRateLimit } from "./send-rate-limit.types";

/**
 * Optional per-API-key send quota on POST /send-email. Mounted after API-key auth (it
 * counts per `apiKeyId`). With no limit configured it is a no-op and touches no table.
 *
 * Over the limit: 429 with `Retry-After` (seconds until the window restarts), in the same
 * `{ success: false, error }` shape as every other error.
 */
export function sendRateLimitMiddleware(
  getLimit: () => SendRateLimit | null,
  getRepository: () => ISendRateLimitRepository,
  now: () => number = Date.now,
): MiddlewareHandler<{ Bindings: Bindings; Variables: UserInfoVariables }> {
  return async (c, next) => {
    const limit = getLimit();
    if (!limit || c.req.method !== "POST") return next();

    const apiKeyId = c.get("apiKeyId");
    const at = now();
    const { count, windowStart } = await getRepository().hit(apiKeyId, at, limit.windowMs);

    c.header("RateLimit-Limit", String(limit.max));
    c.header("RateLimit-Remaining", String(Math.max(0, limit.max - count)));

    if (count > limit.max) {
      const retryAfter = Math.max(1, Math.ceil((windowStart + limit.windowMs - at) / 1000));
      pinoLogger.warn({ apiKeyId, limit: limit.label, count }, "Send rate limit reached");
      c.header("Retry-After", String(retryAfter));
      return c.json(
        {
          success: false,
          error: `Send rate limit reached for this API key (${limit.label}). Retry in ${retryAfter} s.`,
        },
        429,
      );
    }

    return next();
  };
}
