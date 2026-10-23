import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { pinoLogger } from "@/core/logger";
import { MAX_ID_LENGTH } from "@/core/validation";
import type { Bindings, UserInfoVariables } from "@/index";
import { CreateApiKeyDto } from "./api-keys.dto";
import type { ApiKeyService } from "./api-keys.service";

export function createApiKeysController(
  getService: () => ApiKeyService,
): Hono<{ Bindings: Bindings; Variables: UserInfoVariables }> {
  const controller = new Hono<{ Bindings: Bindings; Variables: UserInfoVariables }>();

  controller.get("", async (c) => {
    const userId = c.get("userId");
    pinoLogger.info({ userId }, "GET /api-keys - listing keys");
    const service = getService();
    const keys = await service.findAllByUser(userId);
    pinoLogger.info({ userId, count: keys.length }, "GET /api-keys - returning keys");
    return c.json({ keys }, 200);
  });

  controller.post(
    "",
    zValidator("json", CreateApiKeyDto, (result, c) => {
      if (!result.success) {
        const errors = z.flattenError(result.error);
        pinoLogger.error({ errors }, "POST /api-keys - validation failed");
        return c.json(
          {
            error: "Validation failed",
            details: {
              fieldErrors: errors.fieldErrors,
              formErrors: errors.formErrors,
            },
          },
          400,
        );
      }
    }),
    async (c) => {
      const userId = c.get("userId");
      const data = c.req.valid("json");
      pinoLogger.info({ userId, smtpConfigId: data.smtpConfigId }, "POST /api-keys - creating key");
      const service = getService();

      const result = await service.create(userId, data);
      pinoLogger.info({ userId, apiKeyId: result.record.id }, "POST /api-keys - key created");
      return c.json(result, 201);
    },
  );

  controller.delete(
    "/:id",
    zValidator("param", z.object({ id: z.string().min(1).max(MAX_ID_LENGTH) })),
    async (c) => {
      const userId = c.get("userId");
      const { id } = c.req.valid("param");
      pinoLogger.info({ userId, id }, "DELETE /api-keys/:id - deleting key");
      const service = getService();

      await service.delete(id, userId);
      pinoLogger.info({ userId, id }, "DELETE /api-keys/:id - key deleted");
      return c.json({ success: true }, 200);
    },
  );

  return controller;
}
