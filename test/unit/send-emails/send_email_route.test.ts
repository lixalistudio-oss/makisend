import { describe, it, vi, expect, beforeEach } from "vitest";
import { Hono } from "hono";

import { errorHandler } from "@/middleware/error.handler";
import { createSendEmailController } from "@/send-email/send-email.controller";
import type { SendEmailService } from "@/send-email/send-email.service";

/**
 * Controller tests verify the HTTP boundary: request parsing, Zod
 * validation, and response shaping. The actual service logic is mocked
 * so these tests stay fast and focused on the contract between the
 * client and the controller.
 */
function buildApp(mockService: SendEmailService) {
  const app = new Hono();
  app.onError(errorHandler);

  // Inject the mock service into the Hono context before the controller
  // runs. In production this middleware is provided by createSendEmailModule.
  app.use("/send-email/*", async (c, next) => {
    c.set("sendEmailService", mockService);
    await next();
  });

  app.route("/send-email", createSendEmailController());
  return app;
}

describe("SendEmailController", () => {
  let mockSendFn: ReturnType<typeof vi.fn>;
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSendFn = vi.fn();
    app = buildApp({
      sendEmail: mockSendFn,
    } as unknown as SendEmailService);
  });

  describe("POST /send-email", () => {
    // Happy path: valid payload → service called → 201 with success body.
    it("should return 201 on success", async () => {
      mockSendFn.mockResolvedValue({ message: "Email sent successfully" });

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

      expect(res.status).toBe(201);

      const json = (await res.json()) as {
        success: boolean;
        data: { message: string };
      };
      expect(json).toEqual({
        success: true,
        data: { message: "Email sent successfully" },
      });
    });

    // Invalid payload → Zod rejects before the service is ever called.
    // Each field violates a different constraint so we catch regressions
    // in individual validators.
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

      const json = (await res.json()) as {
        error: string;
        details: { fieldErrors: Record<string, unknown> };
      };
      expect(json.error).toBe("Validation failed");
      expect(json.details.fieldErrors).toBeDefined();
    });

    // The DTO uses `.strict()` so unknown properties must be rejected.
    // This prevents clients from silently sending data the server ignores.
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

    // Empty body → Zod returns field-level errors for all missing fields.
    it("should return 400 when body is empty", async () => {
      const res = await app.request("/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const json = (await res.json()) as {
        details: { fieldErrors: Record<string, unknown> };
      };
      expect(json.details.fieldErrors).toBeDefined();
    });

    // When the service throws (e.g. SMTP failure), the global error
    // handler converts it to a 500 instead of crashing the Worker.
    it("should return 500 when service throws", async () => {
      mockSendFn.mockRejectedValue(
        Object.assign(new Error("SMTP down"), { statusCode: 500 }),
      );

      const res = await app.request("/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: "gedeon@example.com",
          subject: "Testing failure path",
          text: "This text body is long enough to pass validation.",
          html: "<p>Valid HTML content.</p>",
        }),
      });

      expect(res.status).toBe(500);
    });
  });
});
