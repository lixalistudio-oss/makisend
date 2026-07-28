import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Bindings } from "@/index";
import { SendEmailDto } from "./send-email.dto";
import type { SendEmailService } from "./send-email.service";

declare module "hono" {
  interface ContextVariableMap {
    sendEmailService: SendEmailService;
  }
}

export function createSendEmailController(): Hono<{ Bindings: Bindings }> {
  const controller = new Hono<{ Bindings: Bindings }>();

  controller.post(
    "",
    zValidator("json", SendEmailDto, (result, c) => {
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
      const data = c.req.valid("json");
      const service = c.get("sendEmailService");
      const result = await service.sendEmail(data);
      return c.json({ success: true, data: result }, 201);
    },
  );

  return controller;
}
