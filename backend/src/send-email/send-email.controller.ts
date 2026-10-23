import { resolveEncryptionKeys } from "@/config/config";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Bindings, UserInfoVariables } from "@/index";
import { SendEmailPayloadDto } from "./send-email.dto";
import type { SendEmailDto, SendTemplateEmailDto } from "./send-email.dto";
import type { SendEmailQueueMessage, IEmailRepository } from "./send-email.types";
import type { ITemplateRepository } from "@/templates/templates.types";
import { renderTemplateContent } from "@/templates/template-renderer";
import { AppError } from "@/core/errors";
import { encrypt } from "@/core/crypto";
import { createId } from "@paralleldrive/cuid2";

/**
 * Loads the caller's template and renders it into the inline shape the rest of
 * the pipeline already understands — the queue message, workflow and SMTP layer
 * never learn that templates exist.
 *
 * A templateId belonging to another user answers the same 404 as a missing one
 * so ids cannot be probed for existence.
 */
async function resolveTemplatePayload(
  payload: SendTemplateEmailDto,
  userId: string,
  templateRepo: ITemplateRepository,
): Promise<SendEmailDto> {
  const template = await templateRepo.findById(payload.templateId);
  if (!template || template.userId !== userId) {
    throw new AppError(404, "Template not found");
  }

  const rendered = renderTemplateContent(template, payload.variables ?? {});

  return {
    to: payload.to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  };
}

export function createSendEmailController(
  getEmailRepository: () => IEmailRepository,
  getTemplateRepository: () => ITemplateRepository,
): Hono<{ Bindings: Bindings; Variables: UserInfoVariables }> {
  const controller = new Hono<{ Bindings: Bindings; Variables: UserInfoVariables }>();

  controller.post(
    "",
    zValidator("json", SendEmailPayloadDto, (result, c) => {
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
      const payload = c.req.valid("json");
      const userId = c.get("userId");
      const apiKeyId = c.get("apiKeyId");
      const smtpConfigId = c.get("smtpConfigId");
      const emailId = createId();

      // Template branch renders to the inline shape; inline payloads pass through.
      const data: SendEmailDto =
        "templateId" in payload
          ? await resolveTemplatePayload(payload, userId, getTemplateRepository())
          : payload;

      const repository = getEmailRepository();

      // Pending log row first, so the email is visible on the dashboard from the
      // moment it is accepted — even if every later stage fails.
      const [encryptedTo, encryptedText, encryptedHtml] = await Promise.all([
        encrypt(data.to, resolveEncryptionKeys(c.env)),
        encrypt(data.text, resolveEncryptionKeys(c.env)),
        encrypt(data.html, resolveEncryptionKeys(c.env)),
      ]);
      await repository.createPendingEmailLog(emailId, userId, encryptedTo, data.subject, apiKeyId);

      // Bodies stay in D1, encrypted. The queue message only carries the id, so
      // no PII travels through Cloudflare Queues or Workflows state.
      try {
        await repository.saveEmailContent(emailId, {
          text: encryptedText,
          html: encryptedHtml,
          smtpConfigId,
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        await repository.saveEmailHistory(
          emailId,
          "failed",
          `Failed to persist email content: ${reason}`,
        );
        throw err;
      }

      const message: SendEmailQueueMessage = { emailId };

      // Buffered in Cloudflare Queues first; the consumer starts the
      // SendEmailWorkflow from it.
      // No retry here: if the queue refuses the message the caller gets a 5xx and
      // retries the POST itself — but the failure is recorded first.
      try {
        await c.env.SEND_EMAIL_QUEUE.send(message);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        await repository.saveEmailHistory(emailId, "failed", `Failed to enqueue: ${reason}`);
        throw err;
      }

      return c.json({ success: true, message: "Email queued", emailId }, 202);
    },
  );

  return controller;
}
