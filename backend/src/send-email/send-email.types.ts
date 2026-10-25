import type { EmailAttachment } from "./attachments";

export type { EmailAttachment } from "./attachments";

export interface EmailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Absent or empty: a message without attachments. */
  attachments?: EmailAttachment[];
  /** Absent: replies go to the sender address. */
  replyTo?: string;
  /** Custom headers, already validated against the allowlist (custom-headers.ts). */
  headers?: Record<string, string>;
  /**
   * MakiSend's id of the email. Set by the send workflow: the SMTP transport derives the
   * Message-ID from it, and tags it for the provider's bounce webhook (src/bounce-webhooks).
   */
  emailId?: string;
}

export interface EmailSendResult {
  messageId: string;
}

/** Where a log row comes from: an API send, or the dashboard's manual test send. */
export interface PendingEmailLogOptions {
  source?: "api" | "test";
  /** Set for a test (the configuration it went through); API sends reach theirs through the key. */
  smtpConfigId?: string | null;
}

export interface IEmailRepository {
  /**
   * Inserts the log row at enqueue time (smtp_id/sent_at stay NULL until the
   * email is actually delivered). This is what makes failed sends listable.
   */
  createPendingEmailLog(
    internalId: string,
    userId: string,
    to: string,
    subject: string,
    apiKeyId?: string | null,
    options?: PendingEmailLogOptions,
  ): Promise<void>;
  /** Fills in delivery details once the SMTP send succeeds. */
  completeEmailLog(
    internalId: string,
    smtpId: string,
    sentAt: string,
    emailProcessingTimeMs: number,
  ): Promise<void>;
  saveEmailHistory(
    emailId: string,
    status: string,
    error?: string,
    attempts?: number,
  ): Promise<void>;
  /**
   * Stores the message bodies (already AES-GCM encrypted by the caller) so the
   * workflow can rebuild the email from D1 instead of carrying it through the
   * queue.
   */
  saveEmailContent(emailId: string, content: StoredEmailContent): Promise<void>;
  /** Everything needed to send an email, as stored (to/text/html are encrypted). */
  getEmailForSending(emailId: string): Promise<StoredEmail | null>;
  /** Stores the attachments (`content` already AES-GCM encrypted by the caller), in order. */
  saveEmailAttachments(emailId: string, attachments: StoredEmailAttachment[]): Promise<void>;
  /** The attachments of an email, in the order they were sent (`content` encrypted). */
  getEmailAttachments(emailId: string): Promise<StoredEmailAttachment[]>;
}

/** An attachment as stored: `content` is the file as base64, AES-GCM encrypted. */
export interface StoredEmailAttachment {
  filename: string;
  contentType: string;
  content: string;
}

/** Message bodies as written at enqueue time: `text` and `html` are encrypted. */
export interface StoredEmailContent {
  text: string;
  html: string;
  smtpConfigId?: string | null;
  /** Encrypted address. */
  replyTo?: string | null;
  /** Encrypted JSON object of the custom headers. */
  headers?: string | null;
}

/** An email as read back from D1: `to`, `text`, `html`, `replyTo` and `headers` are encrypted, `subject` is clear. */
export interface StoredEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  smtpConfigId: string | null;
  replyTo: string | null;
  headers: string | null;
}

/** An email ready to be sent: decrypted, plus the SMTP configuration it was queued with. */
export interface EmailToSend extends EmailInput {
  smtpConfigId: string | null;
}

export interface IEmailTransport {
  send(input: EmailInput): Promise<EmailSendResult>;
}

/**
 * Payload buffered in the Cloudflare Queue before being handed to the
 * SendEmailWorkflow. Only the id travels: bodies live encrypted in D1
 * (`email_contents`), so queue payloads stay small and contain no PII.
 */
export interface SendEmailQueueMessage {
  emailId: string;
}

