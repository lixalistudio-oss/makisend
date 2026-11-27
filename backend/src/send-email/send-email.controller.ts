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
import { renderTemplateContent } from "@/templates/template-renderer";
import { AppError } from "@/core/errors";
import { encrypt } from "@/core/crypto";
import { pinoLogger } from "@/core/logger";
import { generateTrackingToken } from "@/open-tracking";
import { createId } from "@paralleldrive/cuid2";

/**
 * Where a tracked email's pixel points: `OPEN_TRACKING_BASE_URL` when it is a valid http(s) URL (a
 * stable or dedicated domain), else the origin this request arrived on. The URL stays in the
 * recipient's mailbox for good, so a configured domain must keep reaching this Worker.
 */
export function resolveTrackingBaseUrl(configured: string | undefined, requestUrl: string): string {
  const value = configured?.trim();
  if (value) {
    try {
      const url = new URL(value);
      if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
    } catch {
      // Falls through to the warning below.
    }
    pinoLogger.warn("OPEN_TRACKING_BASE_URL is not an http(s) URL; the pixel uses the request origin");
  }
  return new URL(requestUrl).origin;
}

/** Machine-readable code of the 400 sent when `trackOpens: true` meets an account with tracking off. */
export const OPEN_TRACKING_DISABLED_CODE = "open_tracking_disabled";

/**
 * Whether this email is open-tracked. The account setting is the master switch: the request may
 * only narrow it (`false`) or confirm it (`true`). Asking for tracking on an account that has it
 * off is an error, so the caller never believes an email is tracked when it is not.
 */
async function decideOpenTracking(
  repository: IEmailRepository,
  userId: string,
  apiKeyId: string,
  requested: boolean | undefined,
): Promise<boolean> {
  if (requested === false) return false;

  const accountEnabled = await repository.isOpenTrackingEnabled(userId);
  if (accountEnabled) return true;

  if (requested === true) {
    pinoLogger.warn(
      { userId, apiKeyId },
      "Rejected trackOpens: open tracking is disabled for this account",
    );
    throw new AppError(
      400,
      "Open tracking is disabled for this account. Enable it in the settings, or omit trackOpens.",
      OPEN_TRACKING_DISABLED_CODE,
    );
  }
  return false;
}

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

      // Decided before anything is written: a rejected trackOpens leaves no log row behind.
      const tracked = await decideOpenTracking(repository, userId, apiKeyId, payload.trackOpens);
      // Token and pixel origin are stored together on the log row, so whatever starts the workflow
      // later finds both: a tracked email always goes out with its pixel.
      const tracking = tracked
        ? {
            token: generateTrackingToken(),
            baseUrl: resolveTrackingBaseUrl(c.env.OPEN_TRACKING_BASE_URL, c.req.url),
          }
        : null;

      // Pending log row first, so the email is visible on the dashboard from the
      // moment it is accepted — even if every later stage fails.
      const [encryptedTo, encryptedText, encryptedHtml] = await Promise.all([
        encrypt(data.to, resolveEncryptionKeys(c.env)),
        encrypt(data.text, resolveEncryptionKeys(c.env)),
        encrypt(data.html, resolveEncryptionKeys(c.env)),
      ]);
      await repository.createPendingEmailLog(emailId, userId, encryptedTo, data.subject, apiKeyId, {
        tracking,
      });

      // Bodies stay in D1, encrypted. The queue message only carries the id, so
      // no PII travels through Cloudflare Queues or Workflows state.
      try {
        await repository.saveEmailContent(emailId, {
          text: encryptedText,
          html: encryptedHtml,
          smtpConfigId,
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
