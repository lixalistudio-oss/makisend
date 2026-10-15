import { z } from "zod";

// Caps mirror send-email.dto: the rendered subject/text/html end up in a single
// Cloudflare Queue message (128 KB limit).
export const CreateTemplateDto = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, { message: "Template name is required." })
      .max(100, { message: "Template name must be at most 100 characters." }),
    subject: z
      .string()
      .trim()
      .min(1, { message: "Subject is required." })
      .max(500, { message: "Subject must be at most 500 characters." }),
    html: z
      .string()
      .trim()
      .min(1, { message: "HTML content cannot be empty." })
      .max(100_000, { message: "HTML content must be at most 100000 characters." }),
    text: z
      .string()
      .trim()
      .min(1, { message: "Plain text body cannot be empty." })
      .max(20_000, { message: "Plain text body must be at most 20000 characters." }),
  })
  .strict();

export type CreateTemplateDto = z.infer<typeof CreateTemplateDto>;

export const UpdateTemplateDto = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, { message: "Template name cannot be empty." })
      .max(100, { message: "Template name must be at most 100 characters." })
      .optional(),
    subject: z
      .string()
      .trim()
      .min(1, { message: "Subject cannot be empty." })
      .max(500, { message: "Subject must be at most 500 characters." })
      .optional(),
    html: z
      .string()
      .trim()
      .min(1, { message: "HTML content cannot be empty." })
      .max(100_000, { message: "HTML content must be at most 100000 characters." })
      .optional(),
    text: z
      .string()
      .trim()
      .min(1, { message: "Plain text body cannot be empty." })
      .max(20_000, { message: "Plain text body must be at most 20000 characters." })
      .optional(),
  })
  .strict();

export type UpdateTemplateDto = z.infer<typeof UpdateTemplateDto>;
