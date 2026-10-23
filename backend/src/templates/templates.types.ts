export type TemplateFormat = "legacy" | "react-email" | "react-email-code";

export interface TemplateInput {
  name: string;
  subject: string;
  format?: TemplateFormat;
  editorJson?: string | null;
  source?: string | null;
  html: string;
  text: string;
}

export interface TemplateUpdateInput {
  name?: string;
  subject?: string;
  format?: TemplateFormat;
  editorJson?: string | null;
  source?: string | null;
  html?: string;
  text?: string;
}

export interface TemplateRecord {
  id: string;
  userId: string;
  name: string;
  subject: string;
  format: TemplateFormat;
  editorJson: string | null;
  source: string | null;
  html: string;
  text: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ITemplateRepository {
  create(userId: string, input: TemplateInput): Promise<TemplateRecord>;
  findByUserId(userId: string): Promise<TemplateRecord[]>;
  findById(id: string): Promise<TemplateRecord | null>;
  update(id: string, input: TemplateUpdateInput): Promise<TemplateRecord>;
  delete(id: string): Promise<void>;
}
