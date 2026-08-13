import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Bindings } from "@/index";
import type { UserInfoVariables } from "@/index";
import { SendEmailDto } from "./send-email.dto";
import { inngest } from "@/inngest/send-email";
import { createId } from "@paralleldrive/cuid2";

export function createSendEmailController(): Hono<{ Bindings: Bindings , Variables : UserInfoVariables }> {
  const controller = new Hono<{ Bindings: Bindings ,Variables : UserInfoVariables}>();

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
      const emailId = createId();
      const { userId } = c.get("userConfig");
      await inngest.send({ name: "app/user.authenticated", data: { ...data,userId,emailId } });
      return c.json({ success: true, message: "Email queued" }, 202);   },
  );

  return controller;
}
