import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { pinoLogger } from "@/core/logger";
import { MAX_ID_LENGTH } from "@/core/validation";
import type { Bindings, UserInfoVariables } from "@/index";
import { CreateTemplateDto, UpdateTemplateDto } from "./templates.dto";
import type { TemplateService } from "./templates.service";

export function createTemplatesController(
  getService: () => TemplateService,
): Hono<{ Bindings: Bindings; Variables: UserInfoVariables }> {
  const controller = new Hono<{ Bindings: Bindings; Variables: UserInfoVariables }>();

  controller.get("", async (c) => {
    const userId = c.get("userId");
    pinoLogger.info({ userId }, "GET /templates - listing templates");
    const service = getService();
    const templates = await service.findAllByUser(userId);
    pinoLogger.info({ userId, count: templates.length }, "GET /templates - returning templates");
    return c.json({ templates }, 200);
  });

  controller.post(
    "",
    zValidator("json", CreateTemplateDto, (result, c) => {
      if (!result.success) {
        const errors = z.flattenError(result.error);
        pinoLogger.error({ errors }, "POST /templates - validation failed");
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
      pinoLogger.info({ userId, name: data.name }, "POST /templates - creating template");
      const service = getService();

      const template = await service.create(userId, data);
      pinoLogger.info({ userId, templateId: template.id }, "POST /templates - template created");
      return c.json({ template }, 201);
    },
  );

  controller.get(
    "/:id",
    zValidator("param", z.object({ id: z.string().min(1).max(MAX_ID_LENGTH) })),
    async (c) => {
      const userId = c.get("userId");
      const { id } = c.req.valid("param");
      pinoLogger.info({ userId, id }, "GET /templates/:id - fetching template");
      const service = getService();

      const template = await service.findByIdAndUser(id, userId);
      pinoLogger.info({ userId, id }, "GET /templates/:id - template found");
      return c.json({ template }, 200);
    },
  );

  controller.put(
    "/:id",
    zValidator("param", z.object({ id: z.string().min(1).max(MAX_ID_LENGTH) })),
    zValidator("json", UpdateTemplateDto, (result, c) => {
      if (!result.success) {
        const errors = z.flattenError(result.error);
        pinoLogger.error({ errors }, "PUT /templates/:id - validation failed");
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
      const { id } = c.req.valid("param");
      const updates = c.req.valid("json");
      pinoLogger.info({ userId, id }, "PUT /templates/:id - updating template");
      const service = getService();

      const template = await service.update(id, userId, updates);
      pinoLogger.info({ userId, id }, "PUT /templates/:id - template updated");
      return c.json({ template }, 200);
    },
  );

  controller.delete(
    "/:id",
    zValidator("param", z.object({ id: z.string().min(1).max(MAX_ID_LENGTH) })),
    async (c) => {
      const userId = c.get("userId");
      const { id } = c.req.valid("param");
      pinoLogger.info({ userId, id }, "DELETE /templates/:id - deleting template");
      const service = getService();

      await service.delete(id, userId);
      pinoLogger.info({ userId, id }, "DELETE /templates/:id - template deleted");
      return c.json({ success: true }, 200);
    },
  );

  return controller;
}
