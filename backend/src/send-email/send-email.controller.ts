import { resolveEncryptionKeys } from "@/config/config";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Bindings, UserInfoVariables } from "@/index";
import { SendEmailPayloadDto } from "./send-email.dto";
import { DEFAULT_ATTACHMENT_CONTENT_TYPE } from "./attachments";
import type { SendEmailDto, SendTemplateEmailDto } from "./send-email.dto";
import type { SendEmailQueueMessage, IEmailRepository } from "./send-email.types";
import type { ITemplateRepository } from "@/templates/templates.types";
import type { ISuppressionLookup } from "@/suppressions/suppressions.types";
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
    ...(payload.attachments ? { attachments: payload.attachments } : {}),
    ...(payload.reply_to ? { reply_to: payload.reply_to } : {}),
    ...(payload.headers ? { headers: payload.headers } : {}),
  };
}

export function createSendEmailController(
  getEmailRepository: () => IEmailRepository,
  getTemplateRepository: () => ITemplateRepository,
  getSuppressions?: () => ISuppressionLookup,
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

      // A suppressed address is refused before anything is stored or queued: sending to an
      // address its server already rejected only hurts the sender's reputation.
      const suppressed = getSuppressions ? await getSuppressions().findSuppression(userId, payload.to) : null;
      if (suppressed) {
        throw new AppError(
          422,
          `The recipient is on the suppression list (${suppressed.reason}). Remove it under Suppressions in the dashboard to send to it again.`,
        );
      }

      // Template branch renders to the inline shape; inline payloads pass through.
      const data: SendEmailDto =
        "templateId" in payload
          ? await resolveTemplatePayload(payload, userId, getTemplateRepository())
          : payload;

      const repository = getEmailRepository();

      // Pending log row first, so the email is visible on the dashboard from the
      // moment it is accepted — even if every later stage fails.
      const hasHeaders = data.headers !== undefined && Object.keys(data.headers).length > 0;
      const [encryptedTo, encryptedText, encryptedHtml, encryptedReplyTo, encryptedHeaders] = await Promise.all([
        encrypt(data.to, resolveEncryptionKeys(c.env)),
        encrypt(data.text, resolveEncryptionKeys(c.env)),
        encrypt(data.html, resolveEncryptionKeys(c.env)),
        data.reply_to ? encrypt(data.reply_to, resolveEncryptionKeys(c.env)) : Promise.resolve(null),
        hasHeaders ? encrypt(JSON.stringify(data.headers), resolveEncryptionKeys(c.env)) : Promise.resolve(null),
      ]);
      await repository.createPendingEmailLog(emailId, userId, encryptedTo, data.subject, apiKeyId);

      // Bodies stay in D1, encrypted. The queue message only carries the id, so
      // no PII travels through Cloudflare Queues or Workflows state.
      try {
        await repository.saveEmailContent(emailId, {
          text: encryptedText,
          html: encryptedHtml,
          smtpConfigId,
          replyTo: encryptedReplyTo,
          headers: encryptedHeaders,
        });

        // Attachments: base64 as received, encrypted, one row each (never in the queue).
        if (data.attachments && data.attachments.length > 0) {
          const keys = resolveEncryptionKeys(c.env);
          const stored = await Promise.all(
            data.attachments.map(async (file) => ({
              filename: file.filename,
              contentType: file.content_type ?? DEFAULT_ATTACHMENT_CONTENT_TYPE,
              content: await encrypt(file.content, keys),
            })),
          );
          await repository.saveEmailAttachments(emailId, stored);
        }
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
