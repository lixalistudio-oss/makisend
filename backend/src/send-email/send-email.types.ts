export interface EmailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailSendResult {
  messageId: string;
}

export interface IEmailRepository {
  saveEmailLog(
    internalId : string,///23
    userId: string,
    to: string,
    subject: string,
    smtpId: string,
    sentAt: string,
    emailProcessingTimeMs: number,
    apiKeyId?: string | null,
  ): Promise<void>;
  saveEmailHistory(
    emailId: string,
    status: string,
    error?: string,
  ): Promise<void>;
}

export interface IEmailTransport {
  send(input: EmailInput): Promise<EmailSendResult>;
}

/**
 * Payload buffered in the Cloudflare Queue before being forwarded to Inngest.
 * Mirrors the `app/send-email` event body exactly so the consumer can pass it
 * straight to `inngest.send()`.
 */
export interface SendEmailQueueMessage {
  name: "app/send-email";
  data: {
    to: string;
    subject: string;
    text: string;
    html: string;
    emailId: string;
    userId: string;
    apiKeyId?: string | null;
    smtpConfigId?: string | null;
  };
}

