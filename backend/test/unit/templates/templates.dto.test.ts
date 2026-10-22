import { describe, it, expect } from "vitest";
import { CreateTemplateDto, UpdateTemplateDto } from "@/templates/templates.dto";

const EDITOR_JSON = JSON.stringify({ type: "doc", content: [] });
const BASE = {
  name: "Welcome",
  subject: "Hi {{name}}",
  html: "<p>Hi {{name}}</p>",
  text: "Hi {{name}}",
};

describe("template DTOs", () => {
  it("defaults legacy templates without editor content", () => {
    const result = CreateTemplateDto.safeParse(BASE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.format).toBe("legacy");
      expect(result.data.editorJson).toBeUndefined();
    }
  });

  it("accepts react-email templates with a TipTap document", () => {
    const result = CreateTemplateDto.safeParse({
      ...BASE,
      format: "react-email",
      editorJson: EDITOR_JSON,
    });
    expect(result.success).toBe(true);
  });

  it("requires editor content for react-email templates", () => {
    const result = CreateTemplateDto.safeParse({ ...BASE, format: "react-email" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid editor JSON", () => {
    const result = CreateTemplateDto.safeParse({
      ...BASE,
      format: "react-email",
      editorJson: JSON.stringify({ type: "paragraph" }),
    });
    expect(result.success).toBe(false);
  });

  it("requires editor content when an update switches to react-email", () => {
    const result = UpdateTemplateDto.safeParse({ format: "react-email" });
    expect(result.success).toBe(false);
  });

  it("accepts react-email-code templates with source", () => {
    const result = CreateTemplateDto.safeParse({
      ...BASE,
      format: "react-email-code",
      source: "export default function Email() { return <p>Hi</p>; }",
    });
    expect(result.success).toBe(true);
  });

  it("requires source for react-email-code templates", () => {
    const result = CreateTemplateDto.safeParse({
      ...BASE,
      format: "react-email-code",
    });
    expect(result.success).toBe(false);
  });

  it("requires source when an update switches to react-email-code", () => {
    const result = UpdateTemplateDto.safeParse({ format: "react-email-code" });
    expect(result.success).toBe(false);
  });
});
