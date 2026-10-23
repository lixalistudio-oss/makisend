import type { KeyMaterial } from "@/core/crypto";
import { AppError } from "@/core/errors";
import { decrypt } from "@/core/crypto";
import type { IEmailRepository, EmailToSend } from "./send-email.types";

/**
 * Rebuilds a sendable email from D1. The encryption key never leaves the
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

  const [to, text, html] = await Promise.all([
    decrypt(stored.to, aesKey),
    decrypt(stored.text, aesKey),
    decrypt(stored.html, aesKey),
  ]);

  return {
    to,
    subject: stored.subject,
    text,
    html,
    smtpConfigId: stored.smtpConfigId,
  };
}
