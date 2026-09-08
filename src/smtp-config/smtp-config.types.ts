export interface SmtpConfigInput {
  smtpHostname: string;
  smtpUsername: string;
  smtpPassword: string;
  senderEmail: string;
}

export interface SmtpConfigUpdateInput {
  smtpHostname?: string;
  smtpUsername?: string;
  smtpPassword?: string;
  senderEmail?: string;
  isActive?: boolean;
}

export interface SmtpConfigRecord {
  id: string;
  userId: string;
  smtpHostname: string;
  smtpUsername: string;
  smtpPassword: string;
  senderEmail: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ISmtpConfigRepository {
  create(userId: string, input: SmtpConfigInput): Promise<SmtpConfigRecord>;
  findByUserId(userId: string): Promise<SmtpConfigRecord[]>;
  findById(id: string): Promise<SmtpConfigRecord | null>;
  update(id: string, input: SmtpConfigUpdateInput): Promise<SmtpConfigRecord>;
  delete(id: string): Promise<void>;
}
