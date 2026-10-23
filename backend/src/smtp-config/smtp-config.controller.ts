import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { pinoLogger } from "@/core/logger";
import { MAX_ID_LENGTH } from "@/core/validation";
import type { Bindings, UserInfoVariables } from "@/index";
import { CreateSmtpConfigDto, TestSendDto, UpdateSmtpConfigDto, toTestEmail } from "./smtp-config.dto";
import { toPublicSmtpConfig } from "./smtp-config.types";
import type { SmtpConfigService } from "./smtp-config.service";

export function createSmtpConfigController(
  getService: () => SmtpConfigService,
): Hono<{ Bindings: Bindings; Variables: UserInfoVariables }> {
  const controller = new Hono<{ Bindings: Bindings; Variables: UserInfoVariables }>();

  controller.get("", async (c) => {
    const userId = c.get("userId");
    pinoLogger.info({ userId }, "GET /smtp-config - listing configs");
    const service = getService();
    const configs = await service.findAllByUser(userId);
    pinoLogger.info({ userId, count: configs.length }, "GET /smtp-config - returning configs");
    return c.json({ configs: configs.map(toPublicSmtpConfig) }, 200);
  });

  controller.post(
    "",
    zValidator("json", CreateSmtpConfigDto, (result, c) => {
      if (!result.success) {
        const errors = z.flattenError(result.error);
        pinoLogger.error({ errors }, "POST /smtp-config - validation failed");
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
      pinoLogger.info({ userId, senderEmail: data.senderEmail }, "POST /smtp-config - creating config");
      const service = getService();

      const config = await service.create(userId, data);
      pinoLogger.info({ userId, configId: config.id }, "POST /smtp-config - config created");
      return c.json({ config: toPublicSmtpConfig(config) }, 201);
    },
  );

  // Checks credentials typed in the form before they are saved.
  controller.post(
    "/check",
    zValidator("json", CreateSmtpConfigDto, (result, c) => {
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
      pinoLogger.info({ userId, smtpPort: data.smtpPort, smtpSecurity: data.smtpSecurity }, "POST /smtp-config/check");
      const result = await getService().checkConnection(data);
      return c.json(result, 200);
    },
  );

  controller.post(
    "/:id/check",
    zValidator("param", z.object({ id: z.string().min(1).max(MAX_ID_LENGTH) })),
    async (c) => {
      const userId = c.get("userId");
      const { id } = c.req.valid("param");
      pinoLogger.info({ userId, id }, "POST /smtp-config/:id/check");
      const result = await getService().checkConnectionById(id, userId);
      return c.json(result, 200);
    },
  );

  controller.post(
    "/:id/test-send",
    zValidator("param", z.object({ id: z.string().min(1).max(MAX_ID_LENGTH) })),
    zValidator("json", TestSendDto, (result, c) => {
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
      const { id } = c.req.valid("param");
      const email = toTestEmail(c.req.valid("json"));
      pinoLogger.info({ userId, id, attachments: email.attachments?.length ?? 0 }, "POST /smtp-config/:id/test-send");
      const result = await getService().sendTest(id, userId, email);
      return c.json(result, 200);
    },
  );

  controller.get(
    "/:id",
    zValidator("param", z.object({ id: z.string().min(1).max(MAX_ID_LENGTH) })),
    async (c) => {
      const userId = c.get("userId");
      const { id } = c.req.valid("param");
      pinoLogger.info({ userId, id }, "GET /smtp-config/:id - fetching config");
      const service = getService();

      const config = await service.findByIdAndUser(id, userId);
      pinoLogger.info({ userId, id }, "GET /smtp-config/:id - config found");
      return c.json({ config: toPublicSmtpConfig(config) }, 200);
    },
  );

  controller.put(
    "/:id",
    zValidator("param", z.object({ id: z.string().min(1).max(MAX_ID_LENGTH) })),
    zValidator("json", UpdateSmtpConfigDto, (result, c) => {
      if (!result.success) {
        const errors = z.flattenError(result.error);
        pinoLogger.error({ errors }, "PUT /smtp-config/:id - validation failed");
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
      pinoLogger.info({ userId, id }, "PUT /smtp-config/:id - updating config");
      const service = getService();

      const config = await service.update(id, userId, updates);
      pinoLogger.info({ userId, id }, "PUT /smtp-config/:id - config updated");
      return c.json({ config: toPublicSmtpConfig(config) }, 200);
    },
  );

  controller.delete(
    "/:id",
    zValidator("param", z.object({ id: z.string().min(1).max(MAX_ID_LENGTH) })),
    async (c) => {
      const userId = c.get("userId");
      const { id } = c.req.valid("param");
      pinoLogger.info({ userId, id }, "DELETE /smtp-config/:id - deleting config");
      const service = getService();

      await service.delete(id, userId);
      pinoLogger.info({ userId, id }, "DELETE /smtp-config/:id - config deleted");
      return c.json({ success: true }, 200);
    },
  );

  return controller;
}
