import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { AppError } from "@/core/errors";
import { MAX_ID_LENGTH } from "@/core/validation";
import type { Bindings } from "@/index";
import type { BounceWebhookService } from "./bounce-webhooks.service";

/** Larger than any single provider batch MakiSend expects (SendGrid's are the biggest). */
export const MAX_WEBHOOK_BODY_BYTES = 2 * 1024 * 1024;

/**
 * POST /webhooks/bounces/:smtpConfigId — public: the provider calls it, and the request is
 * authenticated by the configuration's webhook secret (signature or Basic auth), never by a
 * session or an API key. The body is read raw: signatures cover its exact bytes.
 */
export function createBounceWebhooksController(
  getService: () => BounceWebhookService,
): Hono<{ Bindings: Bindings }> {
  const controller = new Hono<{ Bindings: Bindings }>();

  controller.post(
    "/:smtpConfigId",
    zValidator("param", z.object({ smtpConfigId: z.string().min(1).max(MAX_ID_LENGTH) })),
    async (c) => {
      const { smtpConfigId } = c.req.valid("param");
      const declared = Number(c.req.header("content-length") ?? "0");
      if (declared > MAX_WEBHOOK_BODY_BYTES) throw new AppError(413, "Webhook body too large");

      const rawBody = await c.req.text();
      if (new TextEncoder().encode(rawBody).length > MAX_WEBHOOK_BODY_BYTES) {
        throw new AppError(413, "Webhook body too large");
      }

      const report = await getService().handle(smtpConfigId, {
        header: (name) => c.req.header(name),
        rawBody,
      });
      return c.json({ success: true, ...report }, 200);
    },
  );

  return controller;
}
