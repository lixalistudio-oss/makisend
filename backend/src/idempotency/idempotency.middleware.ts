import type { MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError } from "@/core/errors";
import { pinoLogger } from "@/core/logger";
import type { Bindings, UserInfoVariables } from "@/index";
import type { IdempotencyService } from "./idempotency.service";

const MAX_IDEMPOTENCY_KEY_LENGTH = 255;
const VISIBLE_ASCII = /^[\x21-\x7E]+$/;

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * HTTP idempotency for side-effecting API endpoints. Mounted after
 * authentication, because keys are scoped per user.
 *
 * - Same key + same method/path/body → replay the stored response.
 * - Same key + different body → 409.
 * - First request still running → 409.
 * - 5xx/aborted request → the reservation is removed so the client can retry.
 */
export function idempotencyMiddleware(
  getIdempotencyService: () => IdempotencyService,
): MiddlewareHandler<{ Bindings: Bindings; Variables: UserInfoVariables }> {
  return async (c, next) => {
    if (c.req.method !== "POST") {
      return next();
    }

    const rawKey = c.req.header("Idempotency-Key");
    if (rawKey === undefined) {
      return next();
    }

    const key = rawKey.trim();
    if (key.length === 0 || key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw new AppError(
        400,
        `Idempotency-Key must be between 1 and ${MAX_IDEMPOTENCY_KEY_LENGTH} characters.`,
      );
    }
    if (!VISIBLE_ASCII.test(key)) {
      throw new AppError(400, "Idempotency-Key contains invalid characters.");
    }

    const userId = c.get("userId");
    if (!userId) {
      throw new AppError(401, "Unauthorized");
    }

    const route = new URL(c.req.url).pathname;
    const body = await c.req.raw.clone().text();
    const requestHash = await sha256Hex(`${c.req.method}\n${route}\n${body}`);

    const service = getIdempotencyService();
    const decision = await service.begin({ userId, route, key, requestHash });

    if (decision.type === "conflict") {
      throw new AppError(409, decision.message);
    }

    if (decision.type === "replay") {
      c.header("Idempotency-Replayed", "true");
      return c.body(decision.responseBody, decision.statusCode as ContentfulStatusCode, {
        "Content-Type": "application/json; charset=UTF-8",
      });
    }

    c.header("Idempotency-Replayed", "false");

    try {
      await next();
    } catch (err) {
      await service.abandon(decision.recordId).catch((abandonErr) => {
        pinoLogger.error(
          { err: abandonErr, route },
          "Failed to release idempotency reservation",
        );
      });
      throw err;
    }

    if (c.res.status >= 500) {
      await service.abandon(decision.recordId).catch((abandonErr) => {
        pinoLogger.error(
          { err: abandonErr, route },
          "Failed to release idempotency reservation after a 5xx",
        );
      });
      return;
    }

    try {
      const responseBody = await c.res.clone().text();
      await service.complete(decision.recordId, c.res.status, responseBody);
    } catch (err) {
      // The email was accepted; do not turn a successful response into a 5xx.
      // Release the reservation so a client retry can proceed.
      pinoLogger.error({ err, route }, "Failed to persist idempotent response");
      await service.abandon(decision.recordId).catch(() => undefined);
    }
  };
}
