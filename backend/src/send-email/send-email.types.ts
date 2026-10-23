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
    /**
     * Number of times this message has been bounced back onto the queue after
     * an Inngest run died (retries exhausted or the 30s budget blown). The
     * `onFailure` handler abandons the send once it reaches
     * `MAX_QUEUE_CYCLES`, which is what keeps transient errors from looping
     * forever.
     */
    queueCycles: number;
  };
}

