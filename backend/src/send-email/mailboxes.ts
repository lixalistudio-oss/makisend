import { z } from "zod";
import { MAX_EMAIL_LENGTH, MAX_NAME_LENGTH, hasLineBreak } from "@/core/validation";

/**
 * A Cc, Bcc or Reply-To address. Resend accepts a bare address or an
 * `{ email, name }` object, so both shapes are accepted here and normalised to
 * this one: the rest of the pipeline only ever sees `Mailbox`.
 */
export interface Mailbox {
  email: string;
  name?: string;
}

/** A copy list is short by nature; the cap keeps one request (and its stored row) bounded. */
export const MAX_COPY_RECIPIENTS = 10;

/** Header values must never carry a line break: that is how extra headers get injected. */
const noLineBreak = { message: "An address must not contain line breaks." };

const addressString = z
  .string()
  .trim()
  .refine((value) => !hasLineBreak(value), noLineBreak)
  .pipe(z.email({ message: "Please provide a valid email address." }))
  .pipe(
    z.string().max(MAX_EMAIL_LENGTH, {
      message: `An address must be at most ${MAX_EMAIL_LENGTH} characters.`,
    }),
  );

export const MailboxSchema = z.union([
  addressString.transform((email): Mailbox => ({ email })),
  z
    .object({
      email: addressString,
      name: z
        .string()
        .trim()
        .max(MAX_NAME_LENGTH, {
          message: `A display name must be at most ${MAX_NAME_LENGTH} characters.`,
        })
        .refine((value) => !hasLineBreak(value), {
          message: "A display name must not contain line breaks.",
        })
        .optional(),
    })
    .strict()
    .transform(({ email, name }): Mailbox => (name ? { email, name } : { email })),
]);

/** `cc` and `bcc`: a short list of addresses. */
export const MailboxListSchema = z
  .array(MailboxSchema)
  .min(1, { message: "A copy list cannot be empty." })
  .max(MAX_COPY_RECIPIENTS, {
    message: `A copy list holds at most ${MAX_COPY_RECIPIENTS} addresses.`,
  })
  .describe("Copy recipients, as bare addresses or `{ email, name }` objects.");

/** `reply_to`: Resend accepts a single address or a list, so both are valid input. */
export const ReplyToSchema = z
  .union([MailboxSchema, MailboxListSchema])
  .describe("The address answers should go to, instead of the sender address.");

/** One address or a list, as stored and forwarded: always a list, absent when empty. */
export function toMailboxArray(value: Mailbox | Mailbox[] | undefined): Mailbox[] | undefined {
  if (!value) return undefined;
  const list = Array.isArray(value) ? value : [value];
  return list.length > 0 ? list : undefined;
}

/**
 * nodemailer takes `{ name, address }` and does its own header quoting, which a
 * pre-formatted `"Name <address>"` string would bypass.
 */
export function toNodemailerMailboxes(mailboxes: readonly Mailbox[]) {
  return mailboxes.map((mailbox) => ({ name: mailbox.name ?? "", address: mailbox.email }));
}

/** The Worker `send_email` binding wants `{ name, email }`, with a name even when empty. */
export function toCloudflareMailboxes(mailboxes: readonly Mailbox[]) {
  return mailboxes.map((mailbox) => ({ name: mailbox.name ?? "", email: mailbox.email }));
}
