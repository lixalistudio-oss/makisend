import type { KeyMaterial } from "@/core/crypto";
import { AppError } from "@/core/errors";
import { decrypt } from "@/core/crypto";
import { decodeBase64 } from "./attachments";
import type { IEmailRepository, EmailToSend } from "./send-email.types";

/**
 * Rebuilds a sendable email from D1: the recipient, both bodies and the attachments
 * (in the order they were sent), decrypted. The encryption key never leaves the
 * Worker, so queue messages and workflow payloads only need to carry the id.
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

  const [to, text, html, storedAttachments] = await Promise.all([
    decrypt(stored.to, aesKey),
    decrypt(stored.text, aesKey),
    decrypt(stored.html, aesKey),
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
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}
