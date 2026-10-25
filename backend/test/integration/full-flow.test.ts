import { describe, it, vi, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { betterAuth } from "better-auth";
import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { errorHandler } from "@/middleware/error.handler";
import { configMiddleware } from "@/middleware/config.middleware";
import { apiKeyMiddleware } from "@/middleware/api-key.middleware";
import { createSendEmailController } from "@/send-email/send-email.controller";
import { SendEmailRepository } from "@/send-email/send-email.repository";
import { loadEmailForSending } from "@/send-email/send-email.loader";
import { SendEmailWorkflow } from "@/workflows/send-email.workflow";
import {
  IdempotencyRepository,
  IdempotencyService,
  idempotencyMiddleware,
} from "@/idempotency";
import { createDatabase } from "@/db/connection";
import { sendEmailQueueConsumer } from "@/queue/send-email.consumer";
import { encrypt, decrypt } from "@/core/crypto";
import {
  user,
  emailLogs,
  emailHistories,
  emailContents,
  smtpConfig,
  apikey,
} from "@/db/schema";
import { createTestD1, cleanupTestD1 } from "../helpers/d1-setup";
import type { Bindings, UserInfoVariables } from "@/index";
import type { SendEmailQueueMessage } from "@/send-email/send-email.types";
import type { ITemplateRepository } from "@/templates/templates.types";
import type { Miniflare } from "miniflare";
import type { WorkflowStep } from "cloudflare:workers";
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
  let templateRepository: ITemplateRepository;
  let idempotencyService: IdempotencyService;
  let app: Hono<AppEnv>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let auth: any;
  let testApiKey: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockQueueSend: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockWorkflowCreate: any;

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
    mockWorkflowCreate = vi.fn().mockResolvedValue({ id: "instance-123" });
    templateRepository = {
      findById: vi.fn().mockResolvedValue(null),
    } as unknown as ITemplateRepository;
    idempotencyService = new IdempotencyService(
      new IdempotencyRepository(createDatabase(testD1.d1)),
    );

    app = new Hono<AppEnv>();
    app.onError(errorHandler);
    app.use(configMiddleware());
    app.use("/send-email/*", async (c, next) => {
      const config = c.get("appConfig");
      await apiKeyMiddleware(config, auth)(c, next);
    });
    app.use("/send-email/*", idempotencyMiddleware(() => idempotencyService));
    app.route(
      "/send-email",
      createSendEmailController(() => emailRepository, () => templateRepository),
    );
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
      BETTER_AUTH_SECRET: "test-secret-for-integration",
      BETTER_AUTH_URL: "http://localhost:8787",
      FRONTEND_URL: "http://localhost:4321",
      SEND_EMAIL_QUEUE: { send: mockQueueSend } as unknown as Bindings["SEND_EMAIL_QUEUE"],
      SEND_EMAIL_DLQ: { send: vi.fn() } as unknown as Bindings["SEND_EMAIL_DLQ"],
      SEND_EMAIL_WORKFLOW: {
        create: mockWorkflowCreate,
        get: vi.fn(),
      } as unknown as Bindings["SEND_EMAIL_WORKFLOW"],
      ASSETS: {} as Fetcher,
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
      const json = (await res.json()) as {
        success: boolean;
        message: string;
        emailId: string;
      };
      expect(json.success).toBe(true);
      expect(json.message).toBe("Email queued");
      expect(json.emailId).toBeTruthy();

      expect(mockQueueSend).toHaveBeenCalledTimes(1);
      const message = mockQueueSend.mock.calls[0][0] as SendEmailQueueMessage;
      expect(message).toEqual({ emailId: json.emailId });

      // Enqueue-time pending row exists so failures are listable from the start.
      const logs = await db.select().from(emailLogs).all();
      expect(logs.length).toBe(1);
      expect(logs[0].internalId).toBe(message.emailId);
      expect(logs[0].sentAt).toBeNull();
      expect(logs[0].createdAt).toBeTruthy();

      // Bodies are encrypted in D1 and tied to the SMTP config chosen at enqueue.
      const [content] = await db.select().from(emailContents).all();
      expect(content.emailId).toBe(message.emailId);
      expect(content.smtpConfigId).toBe("test-smtp-config-001");
      expect(content.textBody).not.toContain(validPayload.text);
      expect(content.htmlBody).not.toContain("<p>");
      expect(await decrypt(content.textBody, AES_KEY)).toBe(validPayload.text);
      expect(await decrypt(content.htmlBody, AES_KEY)).toBe(validPayload.html);

      // The consumer starts a workflow instance for the buffered message exactly once.
      await sendEmailQueueConsumer(
        {
          messages: [{ body: message, attempts: 1, ack: vi.fn(), retry: vi.fn() }],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        mockEnvWithD1(d1),
      );

      expect(mockWorkflowCreate).toHaveBeenCalledTimes(1);
      expect(mockWorkflowCreate).toHaveBeenCalledWith({
        id: message.emailId,
        params: { emailId: message.emailId },
      });
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

  describe("idempotency", () => {
    it("replays the original 202 and emailId for the same key and body", async () => {
      const d1 = await mf.getD1Database("makisend_db");
      const request = () =>
        app.request(
          "/send-email",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": testApiKey,
              "Idempotency-Key": "integration-key-1",
            },
            body: JSON.stringify(validPayload),
          },
          mockEnvWithD1(d1),
        );

      const first = await request();
      const second = await request();

      expect(first.status).toBe(202);
      expect(second.status).toBe(202);
      expect(first.headers.get("Idempotency-Replayed")).toBe("false");
      expect(second.headers.get("Idempotency-Replayed")).toBe("true");
      expect(await second.json()).toEqual(await first.json());
      expect(mockQueueSend).toHaveBeenCalledTimes(1);

      const logs = await db.select().from(emailLogs).all();
      expect(logs).toHaveLength(1);
    });

    it("rejects the same key with a different body", async () => {
      const d1 = await mf.getD1Database("makisend_db");
      const headers = {
        "Content-Type": "application/json",
        "x-api-key": testApiKey,
        "Idempotency-Key": "integration-key-2",
      };

      const first = await app.request(
        "/send-email",
        {
          method: "POST",
          headers,
          body: JSON.stringify(validPayload),
        },
        mockEnvWithD1(d1),
      );
      const conflict = await app.request(
        "/send-email",
        {
          method: "POST",
          headers,
          body: JSON.stringify({ ...validPayload, subject: "Different subject" }),
        },
        mockEnvWithD1(d1),
      );

      expect(first.status).toBe(202);
      expect(conflict.status).toBe(409);
      expect(await conflict.json()).toMatchObject({
        error: expect.stringContaining("different request body"),
      });
      expect(mockQueueSend).toHaveBeenCalledTimes(1);
    });

    it("allows a retry after a 5xx instead of caching the failure", async () => {
      const d1 = await mf.getD1Database("makisend_db");
      mockQueueSend.mockRejectedValueOnce(new Error("queue unavailable"));

      const request = () =>
        app.request(
          "/send-email",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": testApiKey,
              "Idempotency-Key": "integration-key-3",
            },
            body: JSON.stringify(validPayload),
          },
          mockEnvWithD1(d1),
        );

      const first = await request();
      const retry = await request();

      expect(first.status).toBe(500);
      expect(retry.status).toBe(202);
      expect(mockQueueSend).toHaveBeenCalledTimes(2);
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
        HOST: "smtp.test.com",
        SMTP_USER: "user@test.com",
        SMTP_PASSWORD: "pass",
        SENDER_EMAIL: "sender@test.com",
        BETTER_AUTH_SECRET: "test-secret-for-integration",
        BETTER_AUTH_URL: "http://localhost:8787",
        FRONTEND_URL: "http://localhost:4321",
        SEND_EMAIL_QUEUE: { send: vi.fn().mockRejectedValue(new Error("queue down")) },
        SEND_EMAIL_DLQ: { send: vi.fn() },
        SEND_EMAIL_WORKFLOW: { create: vi.fn(), get: vi.fn() },
        ASSETS: {},
      } as unknown as Bindings);

      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });
});

const { mockResolveTransportFor } = vi.hoisted(() => ({
  mockResolveTransportFor: vi.fn(),
}));

vi.mock("@/send-email/transport-resolver", () => ({
  resolveTransportFor: mockResolveTransportFor,
  // Remaining exports are unused by the workflow under test but keep the
  // module surface complete for other importers in this file.
  buildTransportConfig: vi.fn(),
  findSmtpRecord: vi.fn(),
  decryptSmtpRecord: vi.fn(),
}));

describe("SendEmailWorkflow — full step execution", () => {
  let mf: Miniflare;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  let d1: D1Database;
  let realRepository: SendEmailRepository;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockTransport: any;
  let mockDeadLetterSend: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockTransport = {
      send: vi.fn().mockResolvedValue({ messageId: "<test@mock-smtp.com>" }),
    };
    mockResolveTransportFor.mockResolvedValue(mockTransport);
    mockDeadLetterSend = vi.fn().mockResolvedValue(undefined);

    const testD1 = await createTestD1();
    mf = testD1.mf;
    db = testD1.db;
    d1 = testD1.d1;

    realRepository = new SendEmailRepository(db);
  });

  afterEach(async () => {
    await cleanupTestD1(mf);
  });

  it("should execute all steps and persist to real D1", async () => {
    const emailId = "integration-test-email-id";
    const payload = { emailId };

    // The controller writes these rows at enqueue time; simulate them here since
    // this test invokes the workflow directly (no HTTP layer).
    await realRepository.createPendingEmailLog(
      emailId,
      "test-user-id",
      await encrypt("gedeon@example.com", AES_KEY),
      "Integration Test",
    );
    await realRepository.saveEmailContent(emailId, {
      text: await encrypt("This is a test email body long enough.", AES_KEY),
      html: await encrypt("<p>Integration test content</p>", AES_KEY),
      smtpConfigId: "smtp-config-integration",
    });

    const env = {
      makisend_db: d1,
      SEND_EMAIL_QUEUE: { send: vi.fn() },
      SEND_EMAIL_DLQ: { send: mockDeadLetterSend },
      AES_256_KEY: AES_KEY,
    } as unknown as Bindings;

    const workflow = new SendEmailWorkflow({} as never, env);
    const step = {
      do: async (_name: string, cfgOrFn: unknown, maybeFn?: unknown) => {
        const fn = typeof cfgOrFn === "function" ? cfgOrFn : maybeFn;
        return (fn as (ctx: { attempt: number }) => Promise<unknown>)({
          attempt: 1,
        });
      },
    } as unknown as WorkflowStep;

    const result = await workflow.run({ payload } as never, step);
    expect(result).toMatchObject({ outcome: "sent", messageId: "<test@mock-smtp.com>" });
    expect(mockDeadLetterSend).not.toHaveBeenCalled();

    expect(mockResolveTransportFor).toHaveBeenCalledWith(
      expect.anything(),
      "smtp-config-integration",
    );

    // The workflow rebuilt the exact body from encrypted D1 content.
    const rebuilt = await loadEmailForSending(realRepository, AES_KEY, emailId);
    expect(rebuilt).toEqual({
      to: "gedeon@example.com",
      subject: "Integration Test",
      text: "This is a test email body long enough.",
      html: "<p>Integration test content</p>",
      smtpConfigId: "smtp-config-integration",
    });

    expect(mockTransport.send).toHaveBeenCalledWith({
      to: "gedeon@example.com",
      subject: "Integration Test",
      text: "This is a test email body long enough.",
      html: expect.stringContaining("<p>"),
      // The transport derives the Message-ID (and a bounce-webhook tag) from it.
      emailId: "integration-test-email-id",
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
