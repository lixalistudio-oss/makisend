import { z } from "zod";

export const SendEmailDto = z
  .object({
    to: z.email({ message: "Please provide a valid email address." }).trim(),

    subject: z
      .string()
      .trim()
      .min(3, { message: "Subject must be at least 3 characters." }),

    // Caps keep the queue message well under the Cloudflare Queues 128 KB limit
    // (to + subject + text + html are serialized into a single message body).
    text: z
      .string()
      .trim()
      .min(10, { message: "Plain text body must be at least 10 characters." })
      .max(20_000, { message: "Plain text body must be at most 20000 characters." }),

    html: z
      .string()
      .trim()
      .min(1, { message: "HTML content cannot be empty." })
      .max(100_000, { message: "HTML content must be at most 100000 characters." }),

  })
  .strict();

export type SendEmailDto = z.infer<typeof SendEmailDto>;

// A variable value arrives as a plain scalar; numbers/booleans are common in
// API payloads (order ids, counts) so they are coerced to strings.
const VariableValue = z
  .union([z.string(), z.number(), z.boolean()])
  .transform((value) => String(value));

export const SendTemplateEmailDto = z
  .object({
    to: z.email({ message: "Please provide a valid email address." }).trim(),

    templateId: z
      .string()
      .trim()
      .min(1, { message: "templateId is required." }),

    // Optional: templates without placeholders send with no variables at all.
    variables: z
      .record(z.string().min(1, { message: "Variable names cannot be empty." }), VariableValue)
      .optional(),
  })
  .strict();

export type SendTemplateEmailDto = z.infer<typeof SendTemplateEmailDto>;

// One endpoint, two mutually exclusive shapes: inline content OR templateId +
// variables. A payload mixing both fails both branches and is rejected.
export const SendEmailPayloadDto = z.union([SendEmailDto, SendTemplateEmailDto]);

export type SendEmailPayloadDto = z.infer<typeof SendEmailPayloadDto>;
