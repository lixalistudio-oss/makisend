import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Bindings, UserInfoVariables } from "@/index";
import { SendEmailDto } from "./send-email.dto";
import type { SendEmailQueueMessage } from "./send-email.types";
import { createId } from "@paralleldrive/cuid2";

export function createSendEmailController(): Hono<{ Bindings: Bindings; Variables: UserInfoVariables }> {
  const controller = new Hono<{ Bindings: Bindings; Variables: UserInfoVariables }>();

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
      const userId = c.get("userId");
      const apiKeyId = c.get("apiKeyId");
      const smtpConfigId = c.get("smtpConfigId");
      const emailId = createId();

      const message: SendEmailQueueMessage = {
        name: "app/send-email",
        data: { ...data, emailId, userId, apiKeyId, smtpConfigId },
      };

      // Buffered in Cloudflare Queues first; the consumer forwards it to Inngest.
      // No retry here: if the queue refuses the message the caller gets a 5xx and
      // retries the POST itself.
      await c.env.SEND_EMAIL_QUEUE.send(message);

      return c.json({ success: true, message: "Email queued" }, 202);
    },
  );

  return controller;
}
