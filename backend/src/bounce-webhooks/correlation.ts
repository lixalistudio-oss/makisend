/**
 * Ties a provider's event back to the email MakiSend sent.
 *
 * Every SMTP send carries `Message-ID: <emailId@sender-domain>`, so an event that reports
 * the Message-ID names the email. Providers that also echo a tag (SendGrid, Mailgun,
 * Postmark) get one through `correlationHeaders`; the Message-ID is the fallback.
 * Whatever the event claims, the email is only used when it belongs to the configuration's
 * owner (BounceWebhookService).
 */

/** MakiSend email ids: cuid2 for API sends. Anything else in a Message-ID is not ours. */
const EMAIL_ID = /^[A-Za-z0-9-]{8,64}$/;

/** The Message-ID MakiSend sets on an email: `<emailId@domain-of-the-sender>`. */
export function buildMessageId(emailId: string, senderEmail: string): string {
  const at = senderEmail.lastIndexOf("@");
  const domain = at >= 0 ? senderEmail.slice(at + 1).trim().toLowerCase() : "";
  return `<${emailId}@${domain || "makisend.invalid"}>`;
}

/** The email id inside a Message-ID MakiSend set, or null. */
export function emailIdFromMessageId(messageId: string | null | undefined): string | null {
  if (!messageId) return null;
  const bare = messageId.trim().replace(/^<|>$/g, "");
  const at = bare.lastIndexOf("@");
  if (at <= 0) return null;
  const local = bare.slice(0, at);
  return EMAIL_ID.test(local) ? local : null;
}

/** A plausible email id read from a provider's tag, or null. */
export function parseTaggedEmailId(value: unknown): string | null {
  return typeof value === "string" && EMAIL_ID.test(value) ? value : null;
}

export const MAX_REASON_LENGTH = 500;

/**
 * Text made safe to store in clear and show: one line, no control characters, capped, and no
 * address (recipients are only ever stored encrypted). Callers pass codes and the provider's
 * classification, never its free-text reply, which can carry the address or internal hosts.
 */
export function cleanReason(value: unknown): string {
  if (typeof value !== "string") return "";
  const oneLine = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/[^\s<>()"',;]+@[^\s<>()"',;]+/g, "[address]")
    .replace(/\s+/g, " ")
    .trim();
  return oneLine.length > MAX_REASON_LENGTH ? `${oneLine.slice(0, MAX_REASON_LENGTH - 1)}…` : oneLine;
}

/** Joins the non-empty parts of a reason ("550 5.1.1 · User unknown"). */
export function joinReason(...parts: unknown[]): string {
  return cleanReason(
    parts
      .map((part) => (typeof part === "number" ? String(part) : part))
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .join(" · "),
  );
}
