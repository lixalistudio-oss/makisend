import { z } from "zod";
import {
  hasLineBreak,
  MAX_HTML_LENGTH,
  MAX_NAME_LENGTH,
  MAX_SUBJECT_LENGTH,
  MAX_TEXT_LENGTH,
} from "@/core/validation";

// Caps mirror send-email.dto: the rendered subject/text/html end up in a single
// Cloudflare Queue message (128 KB limit).
export const CreateTemplateDto = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, { message: "Template name is required." })
      .max(MAX_NAME_LENGTH, {
        message: `Template name must be at most ${MAX_NAME_LENGTH} characters.`,
      }),
    subject: z
      .string()
      .trim()
      .min(1, { message: "Subject is required." })
      .max(MAX_SUBJECT_LENGTH, {
        message: `Subject must be at most ${MAX_SUBJECT_LENGTH} characters.`,
      })
      .refine((value) => !hasLineBreak(value), {
        message: "Subject must not contain line breaks.",
      }),
    html: z
      .string()
      .trim()
      .min(1, { message: "HTML content cannot be empty." })
      .max(MAX_HTML_LENGTH, {
        message: `HTML content must be at most ${MAX_HTML_LENGTH} characters.`,
      }),
    text: z
      .string()
      .trim()
      .min(1, { message: "Plain text body cannot be empty." })
      .max(MAX_TEXT_LENGTH, {
        message: `Plain text body must be at most ${MAX_TEXT_LENGTH} characters.`,
      }),
  })
  .strict();

export type CreateTemplateDto = z.infer<typeof CreateTemplateDto>;

export const UpdateTemplateDto = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, { message: "Template name cannot be empty." })
      .max(MAX_NAME_LENGTH, {
        message: `Template name must be at most ${MAX_NAME_LENGTH} characters.`,
      })
      .optional(),
    subject: z
      .string()
      .trim()
      .min(1, { message: "Subject cannot be empty." })
      .max(MAX_SUBJECT_LENGTH, {
        message: `Subject must be at most ${MAX_SUBJECT_LENGTH} characters.`,
      })
      .refine((value) => !hasLineBreak(value), {
        message: "Subject must not contain line breaks.",
      })
      .optional(),
    html: z
      .string()
      .trim()
      .min(1, { message: "HTML content cannot be empty." })
      .max(MAX_HTML_LENGTH, {
        message: `HTML content must be at most ${MAX_HTML_LENGTH} characters.`,
      })
      .optional(),
    text: z
      .string()
      .trim()
      .min(1, { message: "Plain text body cannot be empty." })
      .max(MAX_TEXT_LENGTH, {
        message: `Plain text body must be at most ${MAX_TEXT_LENGTH} characters.`,
      })
      .optional(),
  })
  .strict();

export type UpdateTemplateDto = z.infer<typeof UpdateTemplateDto>;
