import type { KeyMaterial } from "@/core/crypto";
import { AppError } from "@/core/errors";
import { decrypt } from "@/core/crypto";
import { decodeBase64 } from "./attachments";
import type { Mailbox } from "./mailboxes";
import type { IEmailRepository, EmailToSend } from "./send-email.types";

/** A copy list is stored only when it exists: NULL means "the caller sent none". */
async function decryptMailboxes(
  value: string | null,
  aesKey: KeyMaterial,
): Promise<Mailbox[] | undefined> {
  if (!value) return undefined;
  const parsed = JSON.parse(await decrypt(value, aesKey)) as Mailbox[];
  return parsed.length > 0 ? parsed : undefined;
}

/**
 * Rebuilds a sendable email from D1: the recipient, the copies, both bodies and
 * the attachments (in the order they were sent), decrypted. The encryption key
 * never leaves the Worker, so queue messages and workflow payloads only need to
 * carry the id.
 */
export async function loadEmailForSending(
  repository: IEmailRepository,
  aesKey: KeyMaterial,
  emailId: string,
): Promise<EmailToSend> {
  const stored = await repository.getEmailForSending(emailId);
  if (!stored) {
    throw new AppError(404, `Email ${emailId} not found`);
  }

  const [to, text, html, cc, bcc, replyTo, storedAttachments] = await Promise.all([
    decrypt(stored.to, aesKey),
    decrypt(stored.text, aesKey),
    decrypt(stored.html, aesKey),
    decryptMailboxes(stored.cc, aesKey),
    decryptMailboxes(stored.bcc, aesKey),
    decryptMailboxes(stored.replyTo, aesKey),
    repository.getEmailAttachments(emailId),
  ]);

  const attachments = await Promise.all(
    storedAttachments.map(async (file) => ({
      filename: file.filename,
      contentType: file.contentType,
      content: decodeBase64(await decrypt(file.content, aesKey)),
    })),
  );

  return {
    to,
    subject: stored.subject,
    text,
    html,
    smtpConfigId: stored.smtpConfigId,
    ...(cc ? { cc } : {}),
    ...(bcc ? { bcc } : {}),
    ...(replyTo ? { replyTo } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}
