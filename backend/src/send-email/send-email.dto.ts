import { z } from "zod";
import {
  hasLineBreak,
  MAX_EMAIL_LENGTH,
  MAX_HTML_LENGTH,
  MAX_ID_LENGTH,
  MAX_SUBJECT_LENGTH,
  MAX_TEXT_LENGTH,
} from "@/core/validation";
import { TemplateVariablesDto } from "@/templates/templates.dto";
import { AttachmentsDto } from "./attachments";

export const SendEmailDto = z
  .object({
    to: z
      .email({ message: "Please provide a valid email address." })
      .trim()
      .max(MAX_EMAIL_LENGTH, {
        message: `Recipient email must be at most ${MAX_EMAIL_LENGTH} characters.`,
      }),

    subject: z
      .string()
      .trim()
      .min(3, { message: "Subject must be at least 3 characters." })
      .max(MAX_SUBJECT_LENGTH, {
        message: `Subject must be at most ${MAX_SUBJECT_LENGTH} characters.`,
      })
      .refine((value) => !hasLineBreak(value), {
        message: "Subject must not contain line breaks.",
      }),

    // Caps keep the encrypted body safely under D1's 2 MB row limit while
    // allowing normal transactional emails.
    text: z
      .string()
      .trim()
      .min(10, { message: "Plain text body must be at least 10 characters." })
      .max(MAX_TEXT_LENGTH, {
        message: `Plain text body must be at most ${MAX_TEXT_LENGTH} characters.`,
      }),

    html: z
      .string()
      .trim()
      .min(1, { message: "HTML content cannot be empty." })
      .max(MAX_HTML_LENGTH, {
        message: `HTML content must be at most ${MAX_HTML_LENGTH} characters.`,
      }),

    // Resend's shape: `[{ filename, content (base64), content_type? }]`. See attachments.ts.
    attachments: AttachmentsDto.optional(),
  })
  .strict();

export type SendEmailDto = z.infer<typeof SendEmailDto>;

// A variable value arrives as a plain scalar; numbers/booleans are common in
// API payloads (order ids, counts) so they are coerced to strings.
export const SendTemplateEmailDto = z
  .object({
    to: z
      .email({ message: "Please provide a valid email address." })
      .trim()
      .max(MAX_EMAIL_LENGTH, {
        message: `Recipient email must be at most ${MAX_EMAIL_LENGTH} characters.`,
      }),

    templateId: z
      .string()
      .trim()
      .min(1, { message: "templateId is required." })
      .max(MAX_ID_LENGTH, {
        message: `templateId must be at most ${MAX_ID_LENGTH} characters.`,
      }),

    // Optional: templates without placeholders send with no variables at all.
    variables: TemplateVariablesDto.optional(),

    // Same as the inline shape: a templated email can carry files too.
    attachments: AttachmentsDto.optional(),
  })
  .strict();

export type SendTemplateEmailDto = z.infer<typeof SendTemplateEmailDto>;

// One endpoint, two mutually exclusive shapes: inline content OR templateId +
// variables. A payload mixing both fails both branches and is rejected.
export const SendEmailPayloadDto = z.union([SendEmailDto, SendTemplateEmailDto]);

export type SendEmailPayloadDto = z.infer<typeof SendEmailPayloadDto>;
