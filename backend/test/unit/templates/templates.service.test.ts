import { describe, it, expect, vi, beforeEach } from "vitest";
import { TemplateService } from "@/templates/templates.service";
import type {
  ITemplateRepository,
  TemplateRecord,
} from "@/templates/templates.types";

const USER_ID = "user-1";

const template: TemplateRecord = {
  id: "tpl-1",
  userId: USER_ID,
  name: "Welcome",
  subject: "Hi {{name}}",
  format: "react-email",
  editorJson: JSON.stringify({ type: "doc", content: [] }),
  source: null,
  html: "<p>Hi {{name}}</p>",
  text: "Hi {{name}}",
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("TemplateService", () => {
  let repo: {
    findById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let service: TemplateService;

  beforeEach(() => {
    repo = {
      findById: vi.fn().mockResolvedValue(template),
      update: vi.fn().mockResolvedValue(template),
    };
    service = new TemplateService(repo as unknown as ITemplateRepository);
  });

  it("rejects clearing editorJson from a react-email template", async () => {
    await expect(
      service.update("tpl-1", USER_ID, { editorJson: null }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "editorJson is required for react-email templates.",
    });

    expect(repo.update).not.toHaveBeenCalled();
  });

  it("rejects clearing source from a react-email-code template", async () => {
    repo.findById.mockResolvedValue({
      ...template,
      format: "react-email-code",
      editorJson: null,
      source: "export default function Email() { return <p>Hi</p>; }",
    });

    await expect(
      service.update("tpl-1", USER_ID, { source: null }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "source is required for react-email-code templates.",
    });

    expect(repo.update).not.toHaveBeenCalled();
  });

  it("renders a preview with the same missing-variable check as sending", async () => {
    await expect(service.preview("tpl-1", USER_ID, {})).rejects.toMatchObject({
      statusCode: 400,
      message: "Missing template variables: name",
    });

    await expect(
      service.preview("tpl-1", USER_ID, { name: "Joel" }),
    ).resolves.toEqual({
      subject: "Hi Joel",
      html: "<p>Hi Joel</p>",
      text: "Hi Joel",
    });
  });
});
