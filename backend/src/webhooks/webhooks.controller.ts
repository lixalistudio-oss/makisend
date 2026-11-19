import { Hono, type Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { pinoLogger } from "@/core/logger";
import { MAX_ID_LENGTH } from "@/core/validation";
import type { Bindings, UserInfoVariables } from "@/index";
import {
  CreateWebhookEndpointDto,
  ListWebhookDeliveriesQueryDto,
  RotateWebhookSecretDto,
  UpdateWebhookEndpointDto,
} from "./webhooks.dto";
import { toPublicWebhookDelivery, toPublicWebhookEndpoint } from "./webhooks.types";
import { WebhookRateLimitedError, type WebhooksService } from "./webhooks.service";

type Env = { Bindings: Bindings; Variables: UserInfoVariables };

const IdParam = z.object({ id: z.string().min(1).max(MAX_ID_LENGTH) });
const DeliveryParam = IdParam.extend({ deliveryId: z.string().min(1).max(MAX_ID_LENGTH) });

/** 429 in the usual AppError shape, plus the Retry-After header the error handler cannot set. */
function rateLimited(c: Context, error: WebhookRateLimitedError) {
  c.header("Retry-After", String(error.retryAfterSeconds));
  return c.json({ success: false, error: error.message, code: error.code }, 429);
}

/** Same 400 shape as the other modules: `{ error, details: { fieldErrors, formErrors } }`. */
function validationHook(route: string) {
  return (result: { success: boolean; error?: z.core.$ZodError }, c: Context) => {
    if (!result.success && result.error) {
      const errors = z.flattenError(result.error);
      pinoLogger.error({ fields: Object.keys(errors.fieldErrors) }, `${route} - validation failed`);
      return c.json(
        { error: "Validation failed", details: { fieldErrors: errors.fieldErrors, formErrors: errors.formErrors } },
        400,
      );
    }
  };
}

/**
 * /webhooks routes (session auth, mounted in src/index.ts). HTTP only: every rule is in the
 * service, every endpoint goes out through toPublicWebhookEndpoint. Request and response
 * bodies are never logged: they hold the URL and, on create and rotate, the secret.
 */
export function createWebhooksController(getService: () => WebhooksService): Hono<Env> {
  const controller = new Hono<Env>();

  controller.get("", async (c) => {
    const endpoints = await getService().list(c.get("userId"));
    return c.json({ endpoints: endpoints.map((e) => toPublicWebhookEndpoint(e)) }, 200);
  });

  controller.post("", zValidator("json", CreateWebhookEndpointDto, validationHook("POST /webhooks")), async (c) => {
    const { url } = c.req.valid("json");
    const { endpoint, secret } = await getService().create(c.get("userId"), url);
    return c.json({ endpoint: toPublicWebhookEndpoint(endpoint), secret }, 201);
  });

  controller.get("/:id", zValidator("param", IdParam), async (c) => {
    const { id } = c.req.valid("param");
    const endpoint = await getService().get(id, c.get("userId"));
    return c.json({ endpoint: toPublicWebhookEndpoint(endpoint) }, 200);
  });

  controller.put(
    "/:id",
    zValidator("param", IdParam),
    zValidator("json", UpdateWebhookEndpointDto, validationHook("PUT /webhooks/:id")),
    async (c) => {
      const { id } = c.req.valid("param");
      const endpoint = await getService().update(id, c.get("userId"), c.req.valid("json"));
      return c.json({ endpoint: toPublicWebhookEndpoint(endpoint) }, 200);
    },
  );

  controller.delete("/:id", zValidator("param", IdParam), async (c) => {
    const { id } = c.req.valid("param");
    await getService().delete(id, c.get("userId"));
    return c.body(null, 204);
  });

  controller.post(
    "/:id/rotate-secret",
    zValidator("param", IdParam),
    zValidator("json", RotateWebhookSecretDto, validationHook("POST /webhooks/:id/rotate-secret")),
    async (c) => {
      const { id } = c.req.valid("param");
      const { endpoint, secret } = await getService().rotateSecret(id, c.get("userId"), c.req.valid("json"));
      return c.json({ endpoint: toPublicWebhookEndpoint(endpoint), secret }, 200);
    },
  );

  // Route 7: answers 200 even when the receiver failed — the test happened, its result is the body.
  controller.post("/:id/test", zValidator("param", IdParam), async (c) => {
    const { id } = c.req.valid("param");
    try {
      return c.json(await getService().sendTest(id, c.get("userId")), 200);
    } catch (err) {
      if (err instanceof WebhookRateLimitedError) return rateLimited(c, err);
      throw err;
    }
  });

  // Route 9: a failed delivery goes back into the queue.
  controller.post("/:id/deliveries/:deliveryId/retry", zValidator("param", DeliveryParam), async (c) => {
    const { id, deliveryId } = c.req.valid("param");
    try {
      const delivery = await getService().retryDelivery(id, deliveryId, c.get("userId"));
      return c.json({ delivery: toPublicWebhookDelivery(delivery) }, 202);
    } catch (err) {
      if (err instanceof WebhookRateLimitedError) return rateLimited(c, err);
      throw err;
    }
  });

  controller.get(
    "/:id/deliveries",
    zValidator("param", IdParam),
    zValidator("query", ListWebhookDeliveriesQueryDto, validationHook("GET /webhooks/:id/deliveries")),
    async (c) => {
      const { id } = c.req.valid("param");
      const page = await getService().listDeliveries(id, c.get("userId"), c.req.valid("query"));
      return c.json({ deliveries: page.deliveries.map(toPublicWebhookDelivery), nextCursor: page.nextCursor }, 200);
    },
  );

  return controller;
}
