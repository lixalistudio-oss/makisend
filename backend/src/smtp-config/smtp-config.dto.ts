import { z } from "zod";
import { AttachmentsDto } from "@/send-email/attachments";
import {
  MAX_EMAIL_LENGTH,
  MAX_SMTP_PASSWORD_LENGTH,
  MAX_SMTP_USERNAME_LENGTH,
  MAX_SUBJECT_LENGTH,
  MAX_TEXT_LENGTH,
} from "@/core/validation";
import {
  DEFAULT_SMTP_PORT,
  SMTP_PORTS,
  SMTP_SECURITIES,
  defaultSecurityFor,
  isAllowedSmtpPort,
  parseSmtpHostname,
} from "./smtp-host";
import { DKIM_SELECTOR_PATTERN } from "./dns-check";

const smtpHostname = (emptyMessage: string) =>
  z
    .string()
    .trim()
    .min(1, { message: emptyMessage })
    .transform((value, ctx) => {
      const checked = parseSmtpHostname(value);
      if (!checked.ok) {
        ctx.addIssue({ code: "custom", message: checked.message });
        return z.NEVER;
      }
      return checked.hostname;
    });

const smtpPort = z
  .number({ message: "The port must be a number." })
  .int({ message: "The port must be a whole number." })
  .refine(isAllowedSmtpPort, {
    message: `The port must be one of ${SMTP_PORTS.join(", ")}. Port 25 is blocked outbound on Cloudflare Workers.`,
  });

const smtpSecurity = z.enum(SMTP_SECURITIES, {
  message: 'Security must be "tls" (implicit TLS, port 465) or "starttls" (port 587).',
});

const senderEmail = z
  .email({ message: "Please provide a valid sender email address." })
  .trim()
  .max(MAX_EMAIL_LENGTH, {
    message: `Sender email must be at most ${MAX_EMAIL_LENGTH} characters.`,
  });

export const CreateSmtpConfigDto = z
  .object({
    smtpHostname: smtpHostname("SMTP hostname is required."),
    smtpPort: smtpPort.default(DEFAULT_SMTP_PORT),
    smtpSecurity: smtpSecurity.optional(),
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
    senderEmail,
  })
  .strict()
  .transform((dto) => ({
    ...dto,
    smtpSecurity: dto.smtpSecurity ?? defaultSecurityFor(dto.smtpPort),
  }));

export type CreateSmtpConfigDto = z.infer<typeof CreateSmtpConfigDto>;

export const UpdateSmtpConfigDto = z
  .object({
    smtpHostname: smtpHostname("SMTP hostname cannot be empty.").optional(),
    smtpPort: smtpPort.optional(),
    smtpSecurity: smtpSecurity.optional(),
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
    senderEmail: senderEmail.optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export type UpdateSmtpConfigDto = z.infer<typeof UpdateSmtpConfigDto>;

export const TestSendDto = z
  .object({
    to: z
      .string()
      .trim()
      .pipe(z.email({ message: "Please provide a valid recipient email address." }))
      .pipe(z.string().max(MAX_EMAIL_LENGTH, {
        message: `Recipient email must be at most ${MAX_EMAIL_LENGTH} characters.`,
      })),
    subject: z
      .string()
      .trim()
      .min(3, { message: "Subject must be at least 3 characters." })
      .max(MAX_SUBJECT_LENGTH, {
        message: `Subject must be at most ${MAX_SUBJECT_LENGTH} characters.`,
      })
      .default("MakiSend test email"),
    text: z
      .string()
      .trim()
      .min(1, { message: "The message cannot be empty." })
      .max(MAX_TEXT_LENGTH, {
        message: `The message must be at most ${MAX_TEXT_LENGTH} characters.`,
      })
      .default("This is a test email sent from your MakiSend SMTP configuration."),
    // Same shape and limits as POST /send-email (Resend's): try a configuration with a file too.
    attachments: AttachmentsDto.optional(),
  })
  .strict();

export type TestSendDto = z.infer<typeof TestSendDto>;

// GET /smtp-config/:id/dns-check. Without a selector, the usual providers' selectors are tried.
export const DnsCheckQueryDto = z
  .object({
    dkimSelector: z
      .string()
      .trim()
      .max(253, { message: "dkimSelector must be at most 253 characters." })
      .regex(DKIM_SELECTOR_PATTERN, { message: "dkimSelector must be a DNS label, e.g. s1 or google." })
      .optional(),
  })
  .strict();

export type DnsCheckQueryDto = z.infer<typeof DnsCheckQueryDto>;
