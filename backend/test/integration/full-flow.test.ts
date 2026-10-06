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
import { createDatabase } from "@/db/connection";
import { configureDeps, getInngestClient } from "@/inngest/client";
import { getSendEmailFunction } from "@/inngest/send-email";
import { sendEmailQueueConsumer } from "@/queue/send-email.consumer";
import { encrypt, decrypt } from "@/core/crypto";
import { user, emailLogs, emailHistories, smtpConfig, apikey } from "@/db/schema";
import { createTestD1, cleanupTestD1 } from "../helpers/d1-setup";
import type { Bindings, UserInfoVariables } from "@/index";
import type { SendEmailQueueMessage } from "@/send-email/send-email.types";
import type { Miniflare } from "miniflare";
import type { ISmtpConfigRepository } from "@/smtp-config/smtp-config.types";
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
  let emailRepository: SendEmailRepository;
  let app: Hono<AppEnv>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let auth: any;
  let testApiKey: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockQueueSend: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    const testD1 = await createTestD1();
    mf = testD1.mf;
    db = testD1.db;
    emailRepository = new SendEmailRepository(createDatabase(testD1.d1));

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

    // Create user (no SMTP fields on user table)
    await db.insert(user).values({
      id: userId,
      name: "Test User",
      email: "test@example.com",
      emailVerified: true,
    });

    // Create SMTP config linked to user
    const smtpConfigId = "test-smtp-config-001";
    await db.insert(smtpConfig).values({
      id: smtpConfigId,
      userId,
      smtpHostname: encryptedSmtpHost,
      smtpUsername: encryptedSmtpUser,
      smtpPassword: encryptedSmtpPass,
      senderEmail: encryptedSender,
    });

    // Create API key via Better Auth
    const keyResult = await auth.api.createApiKey({
      body: { userId, name: "Test Key", prefix: "mk_" },
    });
    testApiKey = keyResult.key;

    // Link API key to SMTP config
    const latestKey = await db
      .select({ id: apikey.id })
      .from(apikey)
      .where(eq(apikey.referenceId, userId))
      .limit(1);

    await db
      .update(apikey)
      .set({ smtpConfigId })
      .where(eq(apikey.id, latestKey[0].id));

    mockQueueSend = vi.fn().mockResolvedValue(undefined);

    app = new Hono<AppEnv>();
    app.onError(errorHandler);
    app.use(configMiddleware());
    app.use("/send-email/*", async (c, next) => {
      const config = c.get("appConfig");
      await apiKeyMiddleware(config, auth)(c, next);
    });
    app.route("/send-email", createSendEmailController(() => emailRepository));
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
      BETTER_AUTH_SECRET: "test-secret-for-integration",
      BETTER_AUTH_URL: "http://localhost:8787",
      FRONTEND_URL: "http://localhost:4321",
      SEND_EMAIL_QUEUE: { send: mockQueueSend } as unknown as Bindings["SEND_EMAIL_QUEUE"],
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

      expect(mockQueueSend).toHaveBeenCalledTimes(1);
      const message = mockQueueSend.mock.calls[0][0] as SendEmailQueueMessage;
      expect(message.name).toBe("app/send-email");
      expect(message.data.smtpConfigId).toBe("test-smtp-config-001");
      expect(message.data.apiKeyId).toBeTruthy();
      expect(message.data.emailId).toBeTruthy();

      // Enqueue-time pending row exists so failures are listable from the start.
      const logs = await db.select().from(emailLogs).all();
      expect(logs.length).toBe(1);
      expect(logs[0].internalId).toBe(message.data.emailId);
      expect(logs[0].sentAt).toBeNull();
      expect(logs[0].createdAt).toBeTruthy();

      // The consumer forwards the buffered message to Inngest exactly once.
      const clientSendSpy = vi.spyOn(getInngestClient(), "send").mockResolvedValue(undefined as never);
      try {
        await sendEmailQueueConsumer(
          {
            messages: [{ body: message, attempts: 1, ack: vi.fn(), retry: vi.fn() }],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
          mockEnvWithD1(d1),
        );

        expect(clientSendSpy).toHaveBeenCalledTimes(1);
        expect(clientSendSpy).toHaveBeenCalledWith({
          ...message,
          id: message.data.emailId,
        });
      } finally {
        clientSendSpy.mockRestore();
      }
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
      // Cascade delete removes the API key too, so verifyApiKey fails first
      expect(json.error).toMatch(/Invalid API Key|User not found/);
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
        FRONTEND_URL: "http://localhost:4321",
        SEND_EMAIL_QUEUE: { send: vi.fn().mockRejectedValue(new Error("queue down")) },
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
    configureDeps(mockTransport, realRepository, AES_KEY, {} as ISmtpConfigRepository);
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
        userId: "test-user-id",
        to: "gedeon@example.com",
        subject: "Integration Test",
        text: "This is a test email body long enough.",
        html: "<p>Integration test content</p>",
      },
    };

    const resolveTransport = vi.fn(async () => mockTransport);
    configureDeps(
      mockTransport,
      realRepository,
      AES_KEY,
      {} as ISmtpConfigRepository,
      resolveTransport,
    );

    const engine = new InngestTestEngine({
      function: getSendEmailFunction(),
      events: [event],
      transformCtx: (ctx) => ({
        ...ctx,
        repository: realRepository,
        aesKey: AES_KEY,
      }),
    });

    // The controller writes this row at enqueue time; simulate it here since
    // this test invokes the Inngest function directly (no HTTP layer).
    await realRepository.createPendingEmailLog(
      emailId,
      "test-user-id",
      await encrypt("gedeon@example.com", AES_KEY),
      "Integration Test",
    );

    const { error } = await engine.execute();
    expect(error).toBeUndefined();

    // Legacy events queued without smtpConfigId still resolve a transport.
    expect(resolveTransport).toHaveBeenCalledWith(undefined);

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
    expect(logs[0].userId).toBe("test-user-id");
    expect(logs[0].smtpId).toBe("<test@mock-smtp.com>");

    const decryptedTo = await decrypt(logs[0].to, AES_KEY);
    expect(decryptedTo).toBe("gedeon@example.com");

    const histories = await db.select().from(emailHistories).all();
    const statuses = histories.map((h: { status: string }) => h.status);
    expect(statuses).toContain("received");
    expect(statuses).toContain("processing");
    expect(statuses).toContain("cleaned");
    expect(statuses).toContain("sent");

    // The successful attempt is recorded so the timeline shows retries on success.
    const sentEntry = histories.find((h: { status: string }) => h.status === "sent");
    expect(sentEntry.attempts).toBe(1);

    for (const h of histories) {
      expect(h.emailId).toBe(emailId);
    }
  });
});
