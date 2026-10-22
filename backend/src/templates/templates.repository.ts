import { templates } from "@/db/schema";
import type { Database } from "@/db/connection";
import type {
  ITemplateRepository,
  TemplateInput,
  TemplateUpdateInput,
  TemplateRecord,
} from "./templates.types";
import { eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";

export class TemplateRepository implements ITemplateRepository {
  constructor(private readonly db: Database) {}

  async create(userId: string, input: TemplateInput): Promise<TemplateRecord> {
    const id = createId();
    await this.db.insert(templates).values({
      id,
      userId,
      name: input.name,
      subject: input.subject,
      format: input.format ?? "legacy",
      editorJson: input.editorJson ?? null,
      source: input.source ?? null,
      html: input.html,
      text: input.text,
    });

    const result = await this.findById(id);
    return result!;
  }

  async findByUserId(userId: string): Promise<TemplateRecord[]> {
    const results = await this.db
      .select()
      .from(templates)
      .where(eq(templates.userId, userId));

    return results.map(this.toRecord);
  }

  async findById(id: string): Promise<TemplateRecord | null> {
    const result = await this.db
      .select()
      .from(templates)
      .where(eq(templates.id, id))
      .limit(1);

    return result[0] ? this.toRecord(result[0]) : null;
  }

  async update(id: string, input: TemplateUpdateInput): Promise<TemplateRecord> {
    await this.db
      .update(templates)
      .set(input)
      .where(eq(templates.id, id));

    const result = await this.findById(id);
    return result!;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(templates).where(eq(templates.id, id));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toRecord(row: any): TemplateRecord {
    return {
      id: row.id,
      userId: row.userId,
      name: row.name,
      subject: row.subject,
      format: row.format,
      editorJson: row.editorJson,
      source: row.source,
      html: row.html,
      text: row.text,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
