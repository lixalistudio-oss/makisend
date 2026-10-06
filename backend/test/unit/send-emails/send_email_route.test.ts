import { describe, it, vi, expect, beforeEach } from "vitest";
import { Hono } from "hono";

import { errorHandler } from "@/middleware/error.handler";
import { createSendEmailController } from "@/send-email/send-email.controller";
import type { SendEmailQueueMessage } from "@/send-email/send-email.types";

const queueEnv = (send: ReturnType<typeof vi.fn>) => ({
  SEND_EMAIL_QUEUE: { send },
});

function buildApp() {
  const mockQueueSend = vi.fn().mockResolvedValue(undefined);

  const app = new Hono();
  app.onError(errorHandler);
  app.route("/send-email", createSendEmailController());
  return { app, mockQueueSend };
}

describe("SendEmailController", () => {
  let app: Hono;
  let mockQueueSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    const built = buildApp();
    app = built.app;
    mockQueueSend = built.mockQueueSend;
  });

  describe("POST /send-email", () => {
    it("should return 202 and buffer the event in the queue", async () => {
      const res = await app.request("/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: "gedeon@example.com",
          subject: "Testing Feature Modules",
          text: "This text body is long enough to pass validation.",
          html: "<p>This HTML content is valid and sanitized.</p>",
        }),
      }, queueEnv(mockQueueSend));

      expect(res.status).toBe(202);
      expect(mockQueueSend).toHaveBeenCalledTimes(1);

      const message = mockQueueSend.mock.calls[0][0] as SendEmailQueueMessage;
      expect(message.name).toBe("app/send-email");
      expect(message.data.to).toBe("gedeon@example.com");
      expect(message.data.emailId).toBeTruthy();

      const json = (await res.json()) as { success: boolean; message: string };
      expect(json.success).toBe(true);
    });

    it("should return 500 when the queue refuses the message", async () => {
      mockQueueSend.mockRejectedValue(new Error("queue unavailable"));

      const res = await app.request("/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: "gedeon@example.com",
          subject: "Testing Feature Modules",
          text: "This text body is long enough to pass validation.",
          html: "<p>This HTML content is valid and sanitized.</p>",
        }),
      }, queueEnv(mockQueueSend));

      expect(res.status).toBe(500);
      expect(mockQueueSend).toHaveBeenCalledTimes(1);
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
      }, queueEnv(mockQueueSend));

      expect(res.status).toBe(400);
      expect(mockQueueSend).not.toHaveBeenCalled();
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
      }, queueEnv(mockQueueSend));

      expect(res.status).toBe(400);
    });

    it("should return 400 when body is empty", async () => {
      const res = await app.request("/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }, queueEnv(mockQueueSend));

      expect(res.status).toBe(400);
    });

    it("should return 400 when html exceeds the queue message cap", async () => {
      const res = await app.request("/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: "valid@example.com",
          subject: "Valid subject",
          text: "This text body is long enough.",
          html: `<p>${"a".repeat(100_001)}</p>`,
        }),
      }, queueEnv(mockQueueSend));

      expect(res.status).toBe(400);
      expect(mockQueueSend).not.toHaveBeenCalled();
      const json = (await res.json()) as {
        error: string;
        details: { fieldErrors: Record<string, string[] | undefined> };
      };
      expect(json.details.fieldErrors.html?.[0]).toContain("at most 100000");
    });

    it("should return 400 when text exceeds the queue message cap", async () => {
      const res = await app.request("/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: "valid@example.com",
          subject: "Valid subject",
          text: "b".repeat(20_001),
          html: "<p>Valid HTML</p>",
        }),
      }, queueEnv(mockQueueSend));

      expect(res.status).toBe(400);
      expect(mockQueueSend).not.toHaveBeenCalled();
      const json = (await res.json()) as {
        error: string;
        details: { fieldErrors: Record<string, string[] | undefined> };
      };
      expect(json.details.fieldErrors.text?.[0]).toContain("at most 20000");
    });
  });
});
