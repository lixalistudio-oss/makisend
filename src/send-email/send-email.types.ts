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
    userId: string,
    to: string,
    subject: string,
    smtpId: string,
    sentAt: string,
    emailProcessingTimeMs: number,
  ): Promise<void>;
}

export interface IEmailTransport {
  send(input: EmailInput): Promise<EmailSendResult>;
}

