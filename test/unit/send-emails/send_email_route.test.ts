import { describe, it, vi, expect } from "vitest";
import { Hono } from "hono";

import { errorHandler } from "@/middleware/error.handler";
import { createSendEmailController } from "@/send-email/send-email.controller";
import type { SendEmailService } from "@/send-email/send-email.service";

const app = new Hono();
app.onError(errorHandler);

const mockSendFn = vi.fn();
const mockService = {
  sendEmail: mockSendFn,
} as unknown as SendEmailService;

app.use("/send-email/*", async (c, next) => {
  c.set("sendEmailService", mockService);
  await next();
});

app.route("/send-email", createSendEmailController());

describe("SendEmailController", () => {
  describe("POST /send-email", () => {
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

      const json = await res.json();
      expect(json).toEqual({
        success: true,
        data: { message: "Email sent successfully" },
      });
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

      const json = await res.json();
      expect(json.error).toBe("Validation failed");
      expect(json.details.fieldErrors).toBeDefined();
    });
  });
});
