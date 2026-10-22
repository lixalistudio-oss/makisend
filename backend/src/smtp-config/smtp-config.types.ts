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

export interface ISmtpConfigRepository {
  create(userId: string, input: SmtpConfigInput): Promise<SmtpConfigRecord>;
  findByUserId(userId: string): Promise<SmtpConfigRecord[]>;
  findAll(): Promise<SmtpConfigRecord[]>;
  findById(id: string): Promise<SmtpConfigRecord | null>;
  update(id: string, input: SmtpConfigUpdateInput): Promise<SmtpConfigRecord>;
  delete(id: string): Promise<void>;
}
