import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Bindings, UserInfoVariables } from "@/index";
import { CreateSmtpConfigDto, UpdateSmtpConfigDto } from "./smtp-config.dto";
import { encrypt } from "@/core/crypto";
import { AppError } from "@/core/errors";
import type { ISmtpConfigRepository } from "./smtp-config.types";
import type { IApiKeyRepository } from "@/api-keys/api-keys.types";

export function createSmtpConfigController(
  getRepository: () => ISmtpConfigRepository,
  getAesKey: () => string,
  getApiKeyRepository: () => IApiKeyRepository,
): Hono<{ Bindings: Bindings; Variables: UserInfoVariables }> {
  const controller = new Hono<{ Bindings: Bindings; Variables: UserInfoVariables }>();

  controller.get("", async (c) => {
    const userId = c.get("userId");
    const repo = getRepository();
    const configs = await repo.findByUserId(userId);
    return c.json({ configs }, 200);
  });

  controller.post(
    "",
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
      const repo = getRepository();
      const aesKey = getAesKey();
      const apiKeyRepo = getApiKeyRepository();

      const [encryptedHostname, encryptedUsername, encryptedPassword, encryptedSenderEmail] =
        await Promise.all([
          encrypt(data.smtpHostname, aesKey),
          encrypt(data.smtpUsername, aesKey),
          encrypt(data.smtpPassword, aesKey),
          encrypt(data.senderEmail, aesKey),
        ]);

      const config = await repo.create(userId, {
        smtpHostname: encryptedHostname,
        smtpUsername: encryptedUsername,
        smtpPassword: encryptedPassword,
        senderEmail: encryptedSenderEmail,
      });

      // Auto-create API key linked to this config
      const apiKey = await apiKeyRepo.create(userId, {
        smtpConfigId: config.id,
        name: `${data.senderEmail} Key`,
      });

      return c.json({ config, apiKey }, 201);
    },
  );

  controller.get(
    "/:id",
    zValidator("param", z.object({ id: z.string().min(1) })),
    async (c) => {
      const userId = c.get("userId");
      const { id } = c.req.valid("param");
      const repo = getRepository();

      const config = await repo.findById(id);
      if (!config) {
        throw new AppError(404, "SMTP config not found");
      }
      if (config.userId !== userId) {
        throw new AppError(403, "Not authorized to access this SMTP config");
      }

      return c.json({ config }, 200);
    },
  );

  controller.put(
    "/:id",
    zValidator("param", z.object({ id: z.string().min(1) })),
    zValidator("json", UpdateSmtpConfigDto, (result, c) => {
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
      const updates = c.req.valid("json");
      const repo = getRepository();
      const aesKey = getAesKey();

      const existing = await repo.findById(id);
      if (!existing) {
        throw new AppError(404, "SMTP config not found");
      }
      if (existing.userId !== userId) {
        throw new AppError(403, "Not authorized to update this SMTP config");
      }

      const encryptedUpdates: Record<string, string | boolean> = {};

      if (updates.smtpHostname) {
        encryptedUpdates.smtpHostname = await encrypt(updates.smtpHostname, aesKey);
      }
      if (updates.smtpUsername) {
        encryptedUpdates.smtpUsername = await encrypt(updates.smtpUsername, aesKey);
      }
      if (updates.smtpPassword) {
        encryptedUpdates.smtpPassword = await encrypt(updates.smtpPassword, aesKey);
      }
      if (updates.senderEmail) {
        encryptedUpdates.senderEmail = await encrypt(updates.senderEmail, aesKey);
      }
      if (updates.isActive !== undefined) {
        encryptedUpdates.isActive = updates.isActive;
      }

      const config = await repo.update(id, encryptedUpdates);
      return c.json({ config }, 200);
    },
  );

  controller.delete(
    "/:id",
    zValidator("param", z.object({ id: z.string().min(1) })),
    async (c) => {
      const userId = c.get("userId");
      const { id } = c.req.valid("param");
      const repo = getRepository();

      const existing = await repo.findById(id);
      if (!existing) {
        throw new AppError(404, "SMTP config not found");
      }
      if (existing.userId !== userId) {
        throw new AppError(403, "Not authorized to delete this SMTP config");
      }

      await repo.delete(id);
      return c.json({ success: true }, 200);
    },
  );

  return controller;
}
