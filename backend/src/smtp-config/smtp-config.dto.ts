import { z } from "zod";

export const CreateSmtpConfigDto = z
  .object({
    smtpHostname: z
      .string()
      .trim()
      .min(1, { message: "SMTP hostname is required." }),
    smtpUsername: z
      .string()
      .trim()
      .min(1, { message: "SMTP username is required." }),
    smtpPassword: z
      .string()
      .trim()
      .min(1, { message: "SMTP password is required." }),
    senderEmail: z
      .email({ message: "Please provide a valid sender email address." })
      .trim(),
  })
  .strict();

export type CreateSmtpConfigDto = z.infer<typeof CreateSmtpConfigDto>;

export const UpdateSmtpConfigDto = z
  .object({
    smtpHostname: z
      .string()
      .trim()
      .min(1, { message: "SMTP hostname cannot be empty." })
      .optional(),
    smtpUsername: z
      .string()
      .trim()
      .min(1, { message: "SMTP username cannot be empty." })
      .optional(),
    smtpPassword: z
      .string()
      .trim()
      .min(1, { message: "SMTP password cannot be empty." })
      .optional(),
    senderEmail: z
      .email({ message: "Please provide a valid sender email address." })
      .trim()
      .optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export type UpdateSmtpConfigDto = z.infer<typeof UpdateSmtpConfigDto>;
