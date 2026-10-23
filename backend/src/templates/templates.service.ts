import { AppError } from "@/core/errors";
import { pinoLogger } from "@/core/logger";
import type {
  ITemplateRepository,
  TemplateInput,
  TemplateUpdateInput,
  TemplateRecord,
} from "./templates.types";

export class TemplateService {
  constructor(private readonly templateRepo: ITemplateRepository) {}

  async findAllByUser(userId: string): Promise<TemplateRecord[]> {
    pinoLogger.info({ userId }, "Fetching all templates for user");
    return this.templateRepo.findByUserId(userId);
  }

  async findByIdAndUser(id: string, userId: string): Promise<TemplateRecord> {
    pinoLogger.info({ id, userId }, "Fetching template by ID");
    const template = await this.templateRepo.findById(id);
    if (!template) {
      throw new AppError(404, "Template not found");
    }
    if (template.userId !== userId) {
      throw new AppError(403, "Not authorized to access this template");
    }
    return template;
  }

  async create(userId: string, input: TemplateInput): Promise<TemplateRecord> {
    pinoLogger.info({ userId, name: input.name }, "Creating template");
    const template = await this.templateRepo.create(userId, input);
    pinoLogger.info({ templateId: template.id }, "Template created successfully");
    return template;
  }

  async update(
    id: string,
    userId: string,
    updates: TemplateUpdateInput,
  ): Promise<TemplateRecord> {
    pinoLogger.info({ id, userId }, "Updating template");

    const existing = await this.templateRepo.findById(id);
    if (!existing) {
      throw new AppError(404, "Template not found");
    }
    if (existing.userId !== userId) {
      throw new AppError(403, "Not authorized to update this template");
    }

    const template = await this.templateRepo.update(id, updates);
    pinoLogger.info({ id }, "Template updated successfully");
    return template;
  }

  async delete(id: string, userId: string): Promise<void> {
    pinoLogger.info({ id, userId }, "Deleting template");

    const existing = await this.templateRepo.findById(id);
    if (!existing) {
      throw new AppError(404, "Template not found");
    }
    if (existing.userId !== userId) {
      throw new AppError(403, "Not authorized to delete this template");
    }

    await this.templateRepo.delete(id);
    pinoLogger.info({ id }, "Template deleted successfully");
  }
}
