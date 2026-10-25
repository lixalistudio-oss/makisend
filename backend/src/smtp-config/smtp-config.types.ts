import type { SmtpSecurity } from "./smtp-host";
import type { BounceWebhookProviderId } from "@/bounce-webhooks/bounce-webhooks.types";

export interface SmtpConfigInput {
  smtpHostname: string;
  smtpPort: number;
  smtpSecurity: SmtpSecurity;
  smtpUsername: string;
  smtpPassword: string;
  senderEmail: string;
}

export interface SmtpConfigUpdateInput {
  smtpHostname?: string;
  smtpPort?: number;
  smtpSecurity?: SmtpSecurity;
  smtpUsername?: string;
  smtpPassword?: string;
  senderEmail?: string;
  isActive?: boolean;
  lastCheckAt?: Date | null;
  lastCheckOk?: boolean | null;
  lastCheckError?: string | null;
  bounceWebhookProvider?: BounceWebhookProviderId | null;
  /** Encrypted. */
  bounceWebhookSecret?: string | null;
}

export interface SmtpConfigRecord {
  id: string;
  userId: string;
  smtpHostname: string;
  smtpPort: number;
  smtpSecurity: SmtpSecurity;
  smtpUsername: string;
  smtpPassword: string;
  senderEmail: string;
  isActive: boolean;
  lastCheckAt: Date | null;
  lastCheckOk: boolean | null;
  lastCheckError: string | null;
  /** Provider of the connected bounce webhook, or null. */
  bounceWebhookProvider: BounceWebhookProviderId | null;
  /** Its secret, encrypted. Never leaves the server. */
  bounceWebhookSecret: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** API-facing representation: never exposes the SMTP password nor the webhook secret. */
export type PublicSmtpConfig = Omit<SmtpConfigRecord, "smtpPassword" | "bounceWebhookSecret">;

export function toPublicSmtpConfig(record: SmtpConfigRecord): PublicSmtpConfig {
  const { smtpPassword: _smtpPassword, bounceWebhookSecret: _bounceWebhookSecret, ...config } = record;
  return config;
}

export interface ISmtpConfigRepository {
  create(userId: string, input: SmtpConfigInput): Promise<SmtpConfigRecord>;
  findByUserId(userId: string): Promise<SmtpConfigRecord[]>;
  findAll(): Promise<SmtpConfigRecord[]>;
  findById(id: string): Promise<SmtpConfigRecord | null>;
  update(id: string, input: SmtpConfigUpdateInput): Promise<SmtpConfigRecord>;
  delete(id: string): Promise<void>;
}
