import { describe, it, vi, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { InngestTestEngine } from "@inngest/test";
import { betterAuth } from "better-auth";
import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { errorHandler } from "@/middleware/error.handler";
import { configMiddleware } from "@/middleware/config.middleware";
import { apiKeyMiddleware } from "@/middleware/api-key.middleware";
import { createSendEmailController } from "@/send-email/send-email.controller";
import { SendEmailRepository } from "@/send-email/send-email.repository";
import { configureDeps } from "@/inngest/client";
import { getSendEmailFunction } from "@/inngest/send-email";
import { encrypt, decrypt } from "@/core/crypto";
import { user, emailLogs, emailHistories } from "@/db/schema";
import { createTestD1, cleanupTestD1 } from "../helpers/d1-setup";
import type { Bindings, UserInfoVariables } from "@/index";
import type { Inngest } from "inngest";
import type { Miniflare } from "miniflare";
import { eq } from "drizzle-orm";

type AppEnv = {
  Bindings: Bindings;
  Variables: UserInfoVariables;
};

const AES_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("POST /send-email — HTTP layer integration", () => {
  let mf: Miniflare;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  let app: Hono<AppEnv>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let auth: any;
  let testApiKey: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    const testD1 = await createTestD1();
    mf = testD1.mf;
    db = testD1.db;

    auth = betterAuth({
      database: drizzleAdapter(db, {
        provider: "sqlite",
        transaction: false,
      }),
      secret: "test-secret-for-integration",
      baseURL: "http://localhost:8787",
      plugins: [apiKey({ defaultPrefix: "mk_" })],
    });

    const userId = "test-user-id-001";
    const encryptedSmtpUser = await encrypt("real_smtp_user", AES_KEY);
    const encryptedSmtpPass = await encrypt("real_smtp_pass", AES_KEY);
    const encryptedSmtpHost = await encrypt("smtp.real-provider.com", AES_KEY);
    const encryptedSender = await encrypt("sender@real-provider.com", AES_KEY);

    await db.insert(user).values({
      id: userId,
      name: "Test User",
      email: "test@example.com",
      smtpUsername: encryptedSmtpUser,
      smtpPassword: encryptedSmtpPass,
      smtpHostName: encryptedSmtpHost,
      senderEmail: encryptedSender,
      emailVerified: true,
    });

    const keyResult = await auth.api.createApiKey({
      body: { userId, name: "Test Key", prefix: "mk_" },
    });
    testApiKey = keyResult.key;

    const mockInngestSend = vi.fn().mockResolvedValue(undefined);
    const mockInngest = { send: mockInngestSend } as unknown as Inngest;

    app = new Hono<AppEnv>();
    app.onError(errorHandler);
    app.use(configMiddleware());
    app.use("/send-email/*", async (c, next) => {
      const config = c.get("appConfig");
      await apiKeyMiddleware(config, auth)(c, next);
    });
    app.route("/send-email", createSendEmailController(() => mockInngest));
  });

  afterEach(async () => {
    await cleanupTestD1(mf);
  });

  const validPayload = {
    to: "gedeon@example.com",
    subject: "Integration Test",
    text: "This is a test email body long enough.",
    html: "<p>Integration test content</p>",
  };

  function mockEnvWithD1(d1: D1Database): Bindings {
    return {
      AES_256_KEY: AES_KEY,
      makisend_db: d1,
      PORT: 587,
      INNGEST_DEV: 1,
      HOST: "smtp.test.com",
      SMTP_USER: "user@test.com",
      SMTP_PASSWORD: "pass",
      SENDER_EMAIL: "sender@test.com",
      BETTER_AUTH_SECRET: "test-secret-for-integration",
      BETTER_AUTH_URL: "http://localhost:8787",
    };
  }

  describe("happy paths", () => {
    it("should return 202 with x-api-key header", async () => {
      const d1 = await mf.getD1Database("makisend_db");
      const res = await app.request("/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": testApiKey },
        body: JSON.stringify(validPayload),
      }, mockEnvWithD1(d1));

      expect(res.status).toBe(202);
      const json = (await res.json()) as { success: boolean; message: string };
      expect(json.success).toBe(true);
      expect(json.message).toBe("Email queued");
    });

    it("should return 202 with Bearer header", async () => {
      const d1 = await mf.getD1Database("makisend_db");
      const res = await app.request("/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${testApiKey}` },
        body: JSON.stringify(validPayload),
      }, mockEnvWithD1(d1));

      expect(res.status).toBe(202);
      const json = (await res.json()) as { success: boolean; message: string };
      expect(json.success).toBe(true);
      expect(json.message).toBe("Email queued");
    });
  });

  describe("auth failures", () => {
    it("should return 401 when no API key is provided", async () => {
      const d1 = await mf.getD1Database("makisend_db");
      const res = await app.request("/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validPayload),
      }, mockEnvWithD1(d1));

      expect(res.status).toBe(401);
      const json = (await res.json()) as { success: boolean; error: string };
      expect(json.success).toBe(false);
      expect(json.error).toBe("Missing x-api-key or Authorization header");
    });

    it("should return 403 when API key is invalid", async () => {
      const d1 = await mf.getD1Database("makisend_db");
      const res = await app.request("/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": "mk_completely-fake-key" },
        body: JSON.stringify(validPayload),
      }, mockEnvWithD1(d1));

      expect(res.status).toBe(403);
      const json = (await res.json()) as { success: boolean; error: string };
      expect(json.success).toBe(false);
      expect(json.error).toBe("Invalid API Key");
    });

    it("should return 403 when user is deleted from DB", async () => {
      const d1 = await mf.getD1Database("makisend_db");
      await db.delete(user).where(eq(user.id, "test-user-id-001"));

      const res = await app.request("/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": testApiKey },
        body: JSON.stringify(validPayload),
      }, mockEnvWithD1(d1));

      expect(res.status).toBe(403);
      const json = (await res.json()) as { success: boolean; error: string };
      expect(json.success).toBe(false);
      expect(json.error).toBe("User not found");
    });
  });

  describe("request failures", () => {
    it("should return 400 when payload is invalid", async () => {
      const d1 = await mf.getD1Database("makisend_db");
      const res = await app.request("/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": testApiKey },
        body: JSON.stringify({ to: "not-an-email", subject: "ab", text: "short", html: "" }),
      }, mockEnvWithD1(d1));

      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe("Validation failed");
    });
  });

  describe("infrastructure failures", () => {
    it("should return an error when DB is unavailable", async () => {
      await mf.dispose();

      const res = await app.request("/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": testApiKey },
        body: JSON.stringify(validPayload),
      }, {
        AES_256_KEY: AES_KEY,
        makisend_db: {} as D1Database,
        PORT: 587,
        INNGEST_DEV: 1,
        HOST: "smtp.test.com",
        SMTP_USER: "user@test.com",
        SMTP_PASSWORD: "pass",
        SENDER_EMAIL: "sender@test.com",
        BETTER_AUTH_SECRET: "test-secret-for-integration",
        BETTER_AUTH_URL: "http://localhost:8787",
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });
});

describe("Inngest send-email function — full step execution", () => {
  let mf: Miniflare;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  let realRepository: SendEmailRepository;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockTransport: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockTransport = {
      send: vi.fn().mockResolvedValue({ messageId: "<test@mock-smtp.com>" }),
    };

    const testD1 = await createTestD1();
    mf = testD1.mf;
    db = testD1.db;

    realRepository = new SendEmailRepository(db);
    configureDeps(mockTransport, realRepository, AES_KEY);
  });

  afterEach(async () => {
    await cleanupTestD1(mf);
  });

  it("should execute all steps and persist to real D1", async () => {
    const emailId = "integration-test-email-id";
    const event = {
      name: "app/send-email" as const,
      data: {
        emailId,
        to: "gedeon@example.com",
        subject: "Integration Test",
        text: "This is a test email body long enough.",
        html: "<p>Integration test content</p>",
      },
    };

    const engine = new InngestTestEngine({
      function: getSendEmailFunction(),
      events: [event],
      transformCtx: (ctx) => ({
        ...ctx,
        transport: mockTransport,
        repository: realRepository,
        aesKey: AES_KEY,
      }),
    });

    const { error } = await engine.execute();
    expect(error).toBeUndefined();

    expect(mockTransport.send).toHaveBeenCalledWith({
      to: "gedeon@example.com",
      subject: "Integration Test",
      text: "This is a test email body long enough.",
      html: expect.stringContaining("<p>"),
    });

    const logs = await db.select().from(emailLogs).all();
    expect(logs.length).toBe(1);
    expect(logs[0].internalId).toBe(emailId);
    expect(logs[0].subject).toBe("Integration Test");
    expect(logs[0].userId).toBe("system");
    expect(logs[0].smtpId).toBe("<test@mock-smtp.com>");

    const decryptedTo = await decrypt(logs[0].to, AES_KEY);
    expect(decryptedTo).toBe("gedeon@example.com");

    const histories = await db.select().from(emailHistories).all();
    const statuses = histories.map((h: { status: string }) => h.status);
    expect(statuses).toContain("received");
    expect(statuses).toContain("processing");
    expect(statuses).toContain("cleaned");
    expect(statuses).toContain("sent");

    for (const h of histories) {
      expect(h.emailId).toBe(emailId);
    }
  });
});
