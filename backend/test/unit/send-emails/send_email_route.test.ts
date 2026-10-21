import { describe, it, vi, expect, beforeEach } from "vitest";
import { Hono } from "hono";

import { errorHandler } from "@/middleware/error.handler";
import { createSendEmailController } from "@/send-email/send-email.controller";
import type { SendEmailQueueMessage } from "@/send-email/send-email.types";
import type { ITemplateRepository, TemplateRecord } from "@/templates/templates.types";

const AES_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const USER_ID = "user-123";

const queueEnv = (send: ReturnType<typeof vi.fn>) => ({
  SEND_EMAIL_QUEUE: { send },
  AES_256_KEY: AES_KEY,
});

const OWNED_TEMPLATE: TemplateRecord = {
  id: "tpl-1",
  userId: USER_ID,
  name: "Welcome",
  subject: "Bienvenue {{username}} !",
  html: "<h1>Bonjour {{username}}</h1><p>Compte : {{email}}</p>",
  text: "Bonjour {{username}}, compte {{email}}",
  createdAt: new Date(),
  updatedAt: new Date(),
};

function buildApp() {
  const mockQueueSend = vi.fn().mockResolvedValue(undefined);

  const mockRepository = {
    createPendingEmailLog: vi.fn().mockResolvedValue(undefined),
    completeEmailLog: vi.fn().mockResolvedValue(undefined),
    saveEmailHistory: vi.fn().mockResolvedValue(undefined),
  };

  const mockTemplateRepository = {
    findById: vi.fn().mockResolvedValue(null),
  } as unknown as ITemplateRepository & { findById: ReturnType<typeof vi.fn> };

  // Mirrors what apiKeyMiddleware puts in the context in production.
  const app = new Hono<{
    Variables: { userId: string; apiKeyId: string; smtpConfigId: string };
  }>();
  app.use("*", async (c, next) => {
    c.set("userId", USER_ID);
    c.set("apiKeyId", "key-123");
    c.set("smtpConfigId", "smtp-123");
    await next();
  });
  app.onError(errorHandler);
  app.route(
    "/send-email",
    createSendEmailController(() => mockRepository, () => mockTemplateRepository),
  );
  return { app, mockQueueSend, mockRepository, mockTemplateRepository };
}

describe("SendEmailController", () => {
  let app: Hono;
  let mockQueueSend: ReturnType<typeof vi.fn>;
  let mockRepository: ReturnType<typeof buildApp>["mockRepository"];
  let mockTemplateRepository: ReturnType<typeof buildApp>["mockTemplateRepository"];

  beforeEach(() => {
    vi.clearAllMocks();
    const built = buildApp();
    app = built.app;
    mockQueueSend = built.mockQueueSend;
    mockRepository = built.mockRepository;
    mockTemplateRepository = built.mockTemplateRepository;
    mockTemplateRepository.findById.mockResolvedValue(null);
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

      // Pending row is written before the queue send.
      expect(mockRepository.createPendingEmailLog).toHaveBeenCalledTimes(1);
      expect(
        mockRepository.createPendingEmailLog.mock.invocationCallOrder[0],
      ).toBeLessThan(mockQueueSend.mock.invocationCallOrder[0]);
      expect(mockRepository.createPendingEmailLog).toHaveBeenCalledWith(
        expect.any(String),
        USER_ID,
        expect.any(String),
        "Testing Feature Modules",
        "key-123",
      );

      const message = mockQueueSend.mock.calls[0][0] as SendEmailQueueMessage;
      expect(message.name).toBe("app/send-email");
      expect(message.data.to).toBe("gedeon@example.com");
      expect(message.data.emailId).toBeTruthy();
      expect(message.data.userId).toBe(USER_ID);

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

      // The enqueue failure is recorded so the dashboard shows it.
      expect(mockRepository.saveEmailHistory).toHaveBeenCalledWith(
        expect.any(String),
        "failed",
        "Failed to enqueue: queue unavailable",
      );
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

  describe("input hardening", () => {
    it("rejects a subject containing CR/LF", async () => {
      const res = await app.request("/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: "valid@example.com",
          subject: "Valid subject\r\nBcc: victim@example.com",
          text: "This text body is long enough.",
          html: "<p>Valid HTML</p>",
        }),
      }, queueEnv(mockQueueSend));

      expect(res.status).toBe(400);
      expect(mockQueueSend).not.toHaveBeenCalled();
    });

    it("rejects a subject over 500 characters", async () => {
      const res = await app.request("/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: "valid@example.com",
          subject: "a".repeat(501),
          text: "This text body is long enough.",
          html: "<p>Valid HTML</p>",
        }),
      }, queueEnv(mockQueueSend));

      expect(res.status).toBe(400);
      expect(mockQueueSend).not.toHaveBeenCalled();
    });
  });

  describe("POST /send-email with templateId", () => {
    it("renders the template variables and queues the result", async () => {
      mockTemplateRepository.findById.mockResolvedValue(OWNED_TEMPLATE);

      const res = await app.request("/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: "joel@example.com",
          templateId: "tpl-1",
          variables: { username: "Joel", email: "joel@example.com" },
        }),
      }, queueEnv(mockQueueSend));

      expect(res.status).toBe(202);
      expect(mockTemplateRepository.findById).toHaveBeenCalledWith("tpl-1");

      // The pending log stores the RENDERED subject, not the raw template.
      expect(mockRepository.createPendingEmailLog).toHaveBeenCalledWith(
        expect.any(String),
        USER_ID,
        expect.any(String),
        "Bienvenue Joel !",
        "key-123",
      );

      // The queue message carries fully rendered inline content — the workflow
      // and SMTP layer never see templateId.
      const message = mockQueueSend.mock.calls[0][0] as SendEmailQueueMessage;
      expect(message.data.subject).toBe("Bienvenue Joel !");
      expect(message.data.html).toBe("<h1>Bonjour Joel</h1><p>Compte : joel@example.com</p>");
      expect(message.data.text).toBe("Bonjour Joel, compte joel@example.com");
      expect(message.data).not.toHaveProperty("templateId");
      expect(message.data).not.toHaveProperty("variables");
    });

    it("HTML-escapes variable values before queueing", async () => {
      mockTemplateRepository.findById.mockResolvedValue({
        ...OWNED_TEMPLATE,
        subject: "Hi",
        html: "<p>{{username}}</p>",
        text: "Hi",
      });

      const res = await app.request("/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: "joel@example.com",
          templateId: "tpl-1",
          variables: { username: "<script>alert(1)</script>" },
        }),
      }, queueEnv(mockQueueSend));

      expect(res.status).toBe(202);
      const message = mockQueueSend.mock.calls[0][0] as SendEmailQueueMessage;
      expect(message.data.html).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
    });

    it("coerces numeric variable values to strings", async () => {
      mockTemplateRepository.findById.mockResolvedValue({
        ...OWNED_TEMPLATE,
        subject: "Order {{orderId}}",
        html: "<p>Order {{orderId}}</p>",
        text: "Order {{orderId}}",
      });

      const res = await app.request("/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: "joel@example.com",
          templateId: "tpl-1",
          variables: { orderId: 123 },
        }),
      }, queueEnv(mockQueueSend));

      expect(res.status).toBe(202);
      const message = mockQueueSend.mock.calls[0][0] as SendEmailQueueMessage;
      expect(message.data.subject).toBe("Order 123");
    });

    it("rejects with 400 listing the missing variables", async () => {
      mockTemplateRepository.findById.mockResolvedValue(OWNED_TEMPLATE);

      const res = await app.request("/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: "joel@example.com",
          templateId: "tpl-1",
          variables: { username: "Joel" },
        }),
      }, queueEnv(mockQueueSend));

      expect(res.status).toBe(400);
      expect(mockQueueSend).not.toHaveBeenCalled();
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe("Missing template variables: email");
    });

    it("answers 404 for a template owned by another user", async () => {
      mockTemplateRepository.findById.mockResolvedValue({
        ...OWNED_TEMPLATE,
        userId: "someone-else",
      });

      const res = await app.request("/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: "joel@example.com",
          templateId: "tpl-1",
          variables: { username: "Joel", email: "joel@example.com" },
        }),
      }, queueEnv(mockQueueSend));

      expect(res.status).toBe(404);
      expect(mockQueueSend).not.toHaveBeenCalled();
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe("Template not found");
    });

    it("answers 404 for an unknown templateId", async () => {
      mockTemplateRepository.findById.mockResolvedValue(null);

      const res = await app.request("/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: "joel@example.com",
          templateId: "nope",
          variables: {},
        }),
      }, queueEnv(mockQueueSend));

      expect(res.status).toBe(404);
      expect(mockQueueSend).not.toHaveBeenCalled();
    });

    it("rejects a payload mixing templateId and inline content", async () => {
      const res = await app.request("/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: "joel@example.com",
          subject: "Inline subject",
          text: "This text body is long enough.",
          html: "<p>Inline</p>",
          templateId: "tpl-1",
        }),
      }, queueEnv(mockQueueSend));

      expect(res.status).toBe(400);
      expect(mockQueueSend).not.toHaveBeenCalled();
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe("Validation failed");
    });

    it("rejects more than 50 template variables", async () => {
      const variables = Object.fromEntries(
        Array.from({ length: 51 }, (_, i) => [`v${i}`, "x"]),
      );

      const res = await app.request("/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: "joel@example.com", templateId: "tpl-1", variables }),
      }, queueEnv(mockQueueSend));

      expect(res.status).toBe(400);
      expect(mockQueueSend).not.toHaveBeenCalled();
    });

    it("rejects a template variable value over 10000 characters", async () => {
      mockTemplateRepository.findById.mockResolvedValue(OWNED_TEMPLATE);

      const res = await app.request("/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: "joel@example.com",
          templateId: "tpl-1",
          variables: { username: "a".repeat(10_001), email: "joel@example.com" },
        }),
      }, queueEnv(mockQueueSend));

      expect(res.status).toBe(400);
      expect(mockQueueSend).not.toHaveBeenCalled();
    });

    it("rejects a rendered subject that gains a line break from a variable", async () => {
      mockTemplateRepository.findById.mockResolvedValue(OWNED_TEMPLATE);

      const res = await app.request("/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: "joel@example.com",
          templateId: "tpl-1",
          variables: { username: "Joel\r\nBcc: victim@example.com", email: "joel@example.com" },
        }),
      }, queueEnv(mockQueueSend));

      expect(res.status).toBe(400);
      expect(mockQueueSend).not.toHaveBeenCalled();
      const json = (await res.json()) as { error: string };
      expect(json.error).toContain("line breaks");
    });
  });
});
