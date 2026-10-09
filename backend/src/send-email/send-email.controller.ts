import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Bindings, UserInfoVariables } from "@/index";
import { SendEmailDto } from "./send-email.dto";
import type { SendEmailQueueMessage, IEmailRepository } from "./send-email.types";
import { encrypt } from "@/core/crypto";
import { createId } from "@paralleldrive/cuid2";

export function createSendEmailController(
  getEmailRepository: () => IEmailRepository,
): Hono<{ Bindings: Bindings; Variables: UserInfoVariables }> {
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

      const repository = getEmailRepository();

      // Pending log row first, so the email is visible on the dashboard from the
      // moment it is accepted — even if every later stage fails.
      const encryptedTo = await encrypt(data.to, c.env.AES_256_KEY);
      await repository.createPendingEmailLog(emailId, userId, encryptedTo, data.subject, apiKeyId);

      const message: SendEmailQueueMessage = {
        name: "app/send-email",
        data: { ...data, emailId, userId, apiKeyId, smtpConfigId, queueCycles: 0 },
      };

      // Buffered in Cloudflare Queues first; the consumer forwards it to Inngest.
      // No retry here: if the queue refuses the message the caller gets a 5xx and
      // retries the POST itself — but the failure is recorded first.
      try {
        await c.env.SEND_EMAIL_QUEUE.send(message);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        await repository.saveEmailHistory(emailId, "failed", `Failed to enqueue: ${reason}`);
        throw err;
      }

      return c.json({ success: true, message: "Email queued" }, 202);
    },
  );

  return controller;
}
