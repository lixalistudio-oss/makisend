import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Bindings, UserInfoVariables } from "@/index";
import { CreateSmtpConfigDto, UpdateSmtpConfigDto } from "./smtp-config.dto";
import type { Inngest } from "inngest";

export function createSmtpConfigController(getInngest: () => Inngest): Hono<{ Bindings: Bindings; Variables: UserInfoVariables }> {
  const controller = new Hono<{ Bindings: Bindings; Variables: UserInfoVariables }>();

  controller.get("", async (c) => {
    const userId = c.get("userId");
    const result = await getInngest().send({
      name: "app/get-smtp-configs-by-user-id",
      data: { userId },
    });
    return c.json({ configs: result }, 200);
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
      const result = await getInngest().send({
        name: "app/create-smtp-config",
        data: { userId, ...data },
      });
      return c.json({ config: result }, 201);
    },
  );

  controller.get(
    "/:id",
    zValidator("param", z.object({ id: z.string().min(1) })),
    async (c) => {
      const userId = c.get("userId");
      const { id } = c.req.valid("param");
      const result = await getInngest().send({
        name: "app/get-smtp-config-by-id",
        data: { id, userId },
      });
      return c.json({ config: result }, 200);
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
      const result = await getInngest().send({
        name: "app/update-smtp-config",
        data: { id, userId, updates },
      });
      return c.json({ config: result }, 200);
    },
  );

  controller.delete(
    "/:id",
    zValidator("param", z.object({ id: z.string().min(1) })),
    async (c) => {
      const userId = c.get("userId");
      const { id } = c.req.valid("param");
      await getInngest().send({
        name: "app/delete-smtp-config",
        data: { id, userId },
      });
      return c.json({ success: true }, 200);
    },
  );

  return controller;
}
