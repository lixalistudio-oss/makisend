import { describe, it, expect } from "vitest";
import { CreateTemplateDto, UpdateTemplateDto } from "@/templates/templates.dto";

const EDITOR_JSON = JSON.stringify({ type: "doc", content: [] });
const TIPTAP_DOC = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Hi {{name}}" }] }],
};
/** Exactly what the visual builder saves (frontend `template-editor.tsx`, BuilderDocument). */
const builderEnvelope = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ version: 2, theme: "basic", content: TIPTAP_DOC, ...overrides });
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

  it("accepts the visual builder's v2 envelope, with either theme", () => {
    for (const theme of ["basic", "minimal"]) {
      const result = CreateTemplateDto.safeParse({
        ...BASE,
        format: "react-email",
        editorJson: builderEnvelope({ theme }),
      });
      expect(result.success).toBe(true);
    }
  });

  it("accepts the v2 envelope when a template is updated", () => {
    const result = UpdateTemplateDto.safeParse({ format: "react-email", editorJson: builderEnvelope() });
    expect(result.success).toBe(true);
  });

  it("rejects an envelope with another version, an unknown theme or content that is not a TipTap document", () => {
    for (const editorJson of [
      builderEnvelope({ version: 3 }),
      builderEnvelope({ theme: "neon" }),
      builderEnvelope({ content: { type: "paragraph" } }),
      builderEnvelope({ content: "<p>Hi</p>" }),
    ]) {
      const result = CreateTemplateDto.safeParse({ ...BASE, format: "react-email", editorJson });
      expect(result.success).toBe(false);
    }
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
