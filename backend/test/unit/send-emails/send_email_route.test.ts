import { describe, it, vi, expect, beforeEach } from "vitest";
import { Hono } from "hono";

import { errorHandler } from "@/middleware/error.handler";
import { createSendEmailController } from "@/send-email/send-email.controller";
import type { Inngest } from "inngest";

function buildApp() {
  const mockInngest = {
    send: vi.fn().mockResolvedValue(undefined),
  } as unknown as Inngest;

  const app = new Hono();
  app.onError(errorHandler);
  app.route("/send-email", createSendEmailController(() => mockInngest));
  return { app, mockInngest };
}

describe("SendEmailController", () => {
  let app: Hono;
  let mockInngest: { send: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    const built = buildApp();
    app = built.app;
    mockInngest = built.mockInngest as unknown as { send: ReturnType<typeof vi.fn> };
  });

  describe("POST /send-email", () => {
    it("should return 202 on success", async () => {
      const res = await app.request("/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: "gedeon@example.com",
          subject: "Testing Feature Modules",
          text: "This text body is long enough to pass validation.",
          html: "<p>This HTML content is valid and sanitized.</p>",
        }),
      });

      expect(res.status).toBe(202);
      expect(mockInngest.send).toHaveBeenCalledTimes(1);

      const json = (await res.json()) as { success: boolean; message: string };
      expect(json.success).toBe(true);
    });

    it("should return 400 when payload is invalid", async () => {
      const res = await app.request("/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: "not-an-email",
          subject: "ab",
          text: "short",
          html: "",
        }),
      });

      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe("Validation failed");
    });

    it("should return 400 when extra fields are present", async () => {
      const res = await app.request("/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: "valid@example.com",
          subject: "Valid subject",
          text: "This text body is long enough.",
          html: "<p>Valid HTML</p>",
          unexpectedField: "should fail",
        }),
      });

      expect(res.status).toBe(400);
    });

    it("should return 400 when body is empty", async () => {
      const res = await app.request("/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });
  });
});
