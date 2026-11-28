import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { errorHandler } from "@/middleware/error.handler";
import { createTemplatesController } from "@/templates/templates.controller";
import type { TemplateService } from "@/templates/templates.service";
import type { Bindings, UserInfoVariables } from "@/index";

const USER_ID = "user-123";

function buildApp(service: TemplateService) {
  const app = new Hono<{ Bindings: Bindings; Variables: UserInfoVariables }>();
  app.use("*", async (c, next) => {
    c.set("userId", USER_ID);
    await next();
  });
  app.onError(errorHandler);
  app.route("/templates", createTemplatesController(() => service));
  return app;
}

describe("TemplatesController create", () => {
  it("saves a visual template sent as the builder's v2 envelope", async () => {
    // The body the dashboard's visual editor sends (template-editor.tsx): before the fix the DTO
    // only accepted a raw TipTap document and answered 400 to every visual template.
    const editorJson = JSON.stringify({
      version: 2,
      theme: "basic",
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hi {{name}}" }] }] },
    });
    const create = vi.fn().mockResolvedValue({ id: "tpl-1", name: "Password reset" });
    const app = buildApp({ create } as unknown as TemplateService);

    const res = await app.request("/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Password reset",
        subject: "Reset your password, {{name}}",
        html: "<p>Hi {{name}}</p>",
        text: "Hi {{name}}",
        format: "react-email",
        editorJson,
      }),
    });

    expect(res.status).toBe(201);
    expect(create).toHaveBeenCalledWith(USER_ID, expect.objectContaining({ format: "react-email", editorJson }));
  });
});

describe("TemplatesController preview", () => {
  let service: TemplateService;
  let preview: ReturnType<typeof vi.fn>;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    preview = vi.fn().mockResolvedValue({
      subject: "Hi Joel",
      html: "<p>Hi Joel</p>",
      text: "Hi Joel",
    });
    service = { preview } as unknown as TemplateService;
    app = buildApp(service);
  });

  it("renders a saved template with the supplied variables", async () => {
    const res = await app.request("/templates/tpl-1/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variables: { name: "Joel", count: 2 } }),
    });

    expect(res.status).toBe(200);
    expect(preview).toHaveBeenCalledWith("tpl-1", USER_ID, {
      name: "Joel",
      count: "2",
    });
    expect(await res.json()).toEqual({
      preview: {
        subject: "Hi Joel",
        html: "<p>Hi Joel</p>",
        text: "Hi Joel",
      },
    });
  });

  it("rejects more than 50 preview variables", async () => {
    const variables = Object.fromEntries(
      Array.from({ length: 51 }, (_, i) => [`v${i}`, "x"]),
    );

    const res = await app.request("/templates/tpl-1/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variables }),
    });

    expect(res.status).toBe(400);
    expect(preview).not.toHaveBeenCalled();
  });
});
