import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Bindings, UserInfoVariables } from "@/index";
import { CreateApiKeyDto } from "./api-keys.dto";
import { AppError } from "@/core/errors";
import type { IApiKeyRepository } from "./api-keys.types";

export function createApiKeysController(
  getRepository: () => IApiKeyRepository,
): Hono<{ Bindings: Bindings; Variables: UserInfoVariables }> {
  const controller = new Hono<{ Bindings: Bindings; Variables: UserInfoVariables }>();

  controller.get("", async (c) => {
    const userId = c.get("userId");
    const repo = getRepository();
    const keys = await repo.findByUserId(userId);
    return c.json({ keys }, 200);
  });

  controller.post(
    "",
    zValidator("json", CreateApiKeyDto, (result, c) => {
      if (!result.success) {
        const errors = z.flattenError(result.error);
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
      const repo = getRepository();

      const result = await repo.create(userId, data);

      return c.json({
        key: result.key,
        config: result.record,
      }, 201);
    },
  );

  controller.delete(
    "/:id",
    zValidator("param", z.object({ id: z.string().min(1) })),
    async (c) => {
      const userId = c.get("userId");
      const id = c.req.param("id");
      const repo = getRepository();

      const existing = await repo.findById(id);
      if (!existing) {
        throw new AppError(404, "API key not found");
      }

      // Verify ownership by checking the API key belongs to this user
      // The referenceId in the apikey table is the userId
      const userKeys = await repo.findByUserId(userId);
      const ownsKey = userKeys.some((k) => k.id === id);
      if (!ownsKey) {
        throw new AppError(403, "Not authorized to delete this API key");
      }

      await repo.delete(id);
      return c.json({ success: true }, 200);
    },
  );

  return controller;
}
