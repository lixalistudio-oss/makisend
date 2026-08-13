import { z } from "zod";

export const SendEmailDto = z
  .object({
    to: z.email({ message: "Please provide a valid email address." }).trim(),

    subject: z
      .string()
      .trim()
      .min(3, { message: "Subject must be at least 3 characters." }),

    text: z
      .string()
      .trim()
      .min(10, { message: "Plain text body must be at least 10 characters." }),

    html: z
      .string()
      .trim()
      .min(1, { message: "HTML content cannot be empty." }),

  })
  .strict();

export type SendEmailDto = z.infer<typeof SendEmailDto>;
