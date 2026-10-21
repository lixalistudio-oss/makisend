import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Bindings, UserInfoVariables } from "@/index";
import { SendEmailPayloadDto } from "./send-email.dto";
import type { SendEmailDto, SendTemplateEmailDto } from "./send-email.dto";
import type { SendEmailQueueMessage, IEmailRepository } from "./send-email.types";
import type { ITemplateRepository } from "@/templates/templates.types";
import {
  extractVariables,
  renderTemplate,
  renderHtmlTemplate,
} from "@/templates/template-renderer";
import { AppError } from "@/core/errors";
import { encrypt } from "@/core/crypto";
import {
  hasLineBreak,
  MAX_HTML_LENGTH,
  MAX_SUBJECT_LENGTH,
  MAX_TEXT_LENGTH,
} from "@/core/validation";
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

  const variables = payload.variables ?? {};
  const declared = extractVariables(template.subject, template.html, template.text);
  const missing = declared.filter((name) => !(name in variables));
  if (missing.length > 0) {
    throw new AppError(400, `Missing template variables: ${missing.join(", ")}`);
  }

  const subject = renderTemplate(template.subject, variables);
  const html = renderHtmlTemplate(template.html, variables);
  const text = renderTemplate(template.text, variables);

  if (hasLineBreak(subject)) {
    throw new AppError(400, "Rendered subject must not contain line breaks.");
  }
  if (subject.length > MAX_SUBJECT_LENGTH) {
    throw new AppError(
      400,
      `Rendered subject must be at most ${MAX_SUBJECT_LENGTH} characters.`,
    );
  }
  if (html.length > MAX_HTML_LENGTH) {
    throw new AppError(
      400,
      `Rendered HTML must be at most ${MAX_HTML_LENGTH} characters.`,
    );
  }
  if (text.length > MAX_TEXT_LENGTH) {
    throw new AppError(
      400,
      `Rendered text must be at most ${MAX_TEXT_LENGTH} characters.`,
    );
  }

  return {
    to: payload.to,
    subject,
    html,
    text,
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
      const encryptedTo = await encrypt(data.to, c.env.AES_256_KEY);
      await repository.createPendingEmailLog(emailId, userId, encryptedTo, data.subject, apiKeyId);

      const message: SendEmailQueueMessage = {
        name: "app/send-email",
        data: { ...data, emailId, userId, apiKeyId, smtpConfigId, queueCycles: 0 },
      };

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

      return c.json({ success: true, message: "Email queued" }, 202);
    },
  );

  return controller;
}
