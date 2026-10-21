import { z } from "zod";
import {
  MAX_EMAIL_LENGTH,
  MAX_SMTP_HOSTNAME_LENGTH,
  MAX_SMTP_PASSWORD_LENGTH,
  MAX_SMTP_USERNAME_LENGTH,
} from "@/core/validation";

export const CreateSmtpConfigDto = z
  .object({
    smtpHostname: z
      .string()
      .trim()
      .min(1, { message: "SMTP hostname is required." })
      .max(MAX_SMTP_HOSTNAME_LENGTH, {
        message: `SMTP hostname must be at most ${MAX_SMTP_HOSTNAME_LENGTH} characters.`,
      }),
    smtpUsername: z
      .string()
      .trim()
      .min(1, { message: "SMTP username is required." })
      .max(MAX_SMTP_USERNAME_LENGTH, {
        message: `SMTP username must be at most ${MAX_SMTP_USERNAME_LENGTH} characters.`,
      }),
    smtpPassword: z
      .string()
      .trim()
      .min(1, { message: "SMTP password is required." })
      .max(MAX_SMTP_PASSWORD_LENGTH, {
        message: `SMTP password must be at most ${MAX_SMTP_PASSWORD_LENGTH} characters.`,
      }),
    senderEmail: z
      .email({ message: "Please provide a valid sender email address." })
      .trim()
      .max(MAX_EMAIL_LENGTH, {
        message: `Sender email must be at most ${MAX_EMAIL_LENGTH} characters.`,
      }),
  })
  .strict();

export type CreateSmtpConfigDto = z.infer<typeof CreateSmtpConfigDto>;

export const UpdateSmtpConfigDto = z
  .object({
    smtpHostname: z
      .string()
      .trim()
      .min(1, { message: "SMTP hostname cannot be empty." })
      .max(MAX_SMTP_HOSTNAME_LENGTH, {
        message: `SMTP hostname must be at most ${MAX_SMTP_HOSTNAME_LENGTH} characters.`,
      })
      .optional(),
    smtpUsername: z
      .string()
      .trim()
      .min(1, { message: "SMTP username cannot be empty." })
      .max(MAX_SMTP_USERNAME_LENGTH, {
        message: `SMTP username must be at most ${MAX_SMTP_USERNAME_LENGTH} characters.`,
      })
      .optional(),
    smtpPassword: z
      .string()
      .trim()
      .min(1, { message: "SMTP password cannot be empty." })
      .max(MAX_SMTP_PASSWORD_LENGTH, {
        message: `SMTP password must be at most ${MAX_SMTP_PASSWORD_LENGTH} characters.`,
      })
      .optional(),
    senderEmail: z
      .email({ message: "Please provide a valid sender email address." })
      .trim()
      .max(MAX_EMAIL_LENGTH, {
        message: `Sender email must be at most ${MAX_EMAIL_LENGTH} characters.`,
      })
      .optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export type UpdateSmtpConfigDto = z.infer<typeof UpdateSmtpConfigDto>;
