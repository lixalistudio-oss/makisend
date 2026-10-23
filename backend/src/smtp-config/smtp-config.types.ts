import type { SmtpSecurity } from "./smtp-host";

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
  createdAt: Date;
  updatedAt: Date;
}

/** API-facing representation: never exposes the SMTP password. */
export type PublicSmtpConfig = Omit<SmtpConfigRecord, "smtpPassword">;

export function toPublicSmtpConfig(record: SmtpConfigRecord): PublicSmtpConfig {
  const { smtpPassword: _smtpPassword, ...config } = record;
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
