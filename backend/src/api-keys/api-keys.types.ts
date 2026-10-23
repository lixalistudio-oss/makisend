export interface ApiKeyCreateInput {
  smtpConfigId: string;
  name?: string;
}

export interface ApiKeyRecord {
  id: string;
  name: string | null;
  prefix: string | null;
  start: string | null;
  enabled: boolean;
  smtpConfigId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiKeyCreatedResult {
  key: string;
  record: ApiKeyRecord;
}

export interface IApiKeyRepository {
  create(userId: string, input: ApiKeyCreateInput): Promise<ApiKeyCreatedResult>;
  findByUserId(userId: string): Promise<ApiKeyRecord[]>;
  findById(id: string): Promise<ApiKeyRecord | null>;
  delete(id: string): Promise<void>;
}
