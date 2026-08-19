import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { apiKeyMiddleware } from "@/middleware/api-key.middleware";
import { errorHandler } from "@/middleware/error.handler";
import * as authModule from "@/lib/auth";
import * as dbModule from "@/db/connection";
import * as cryptoModule from "@/core/crypto";
import type { Database } from "@/db/connection";
import type { Bindings } from "@/index";
import type { UserInfoVariables } from "@/index";

vi.mock("@/lib/auth");
vi.mock("@/db/connection");
vi.mock("@/core/crypto");

type AppEnv = {
  Bindings: Bindings;
  Variables: UserInfoVariables;
};

const mockConfig = {
  db: {} as D1Database,
  aesKey: "a".repeat(64),
  betterAuthSecret: "test-secret",
  betterAuthUrl: "http://localhost:8787",
};

const mockDbQuery = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn(),
};

function buildApp() {
  const app = new Hono<AppEnv>();
  app.onError(errorHandler);
  app.use("*", apiKeyMiddleware(mockConfig as Parameters<typeof apiKeyMiddleware>[0]));
  app.get("/test", (c) => {
    const smtp = c.get("smtpConfig");
    const user = c.get("userConfig");
    return c.json({
      success: true,
      sender: smtp.senderEmail,
      userId: user.userId,
    });
  });
  return app;
}

describe("API Key Middleware", () => {
  let app: Hono<AppEnv>;

  beforeEach(() => {
    vi.resetAllMocks();

    mockDbQuery.select.mockReturnValue(mockDbQuery);
    mockDbQuery.from.mockReturnValue(mockDbQuery);
    mockDbQuery.where.mockReturnValue(mockDbQuery);

    vi.mocked(dbModule.createDatabase).mockReturnValue(
      mockDbQuery as unknown as Database,
    );
    vi.mocked(cryptoModule.decrypt).mockImplementation(
      async (text: string) => `decrypted_${text}`,
    );
    app = buildApp();
  });

  describe("missing or malformed key", () => {
    it("should return 401 if no headers are provided", async () => {
      const res = await app.request("/test");
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("Missing");
    });

    it("should return 401 if x-api-key is empty string", async () => {
      const res = await app.request("/test", {
        headers: { "x-api-key": "" },
      });
      expect(res.status).toBe(401);
    });

    it("should return 401 if Authorization header has no Bearer prefix", async () => {
      const res = await app.request("/test", {
        headers: { Authorization: "mk.valid-key" },
      });
      expect(res.status).toBe(401);
    });
  });

  describe("key not found via Better Auth", () => {
    it("should return 403 if API key is invalid", async () => {
      vi.mocked(authModule.getAuth).mockReturnValue({
        api: {
          verifyApiKey: vi.fn().mockResolvedValue({
            valid: false,
            error: { message: "Invalid API key.", code: "INVALID_API_KEY" },
            key: null,
          }),
        },
      } as any);

      const res = await app.request("/test", {
        headers: { "x-api-key": "mk.unknown-key" },
      });
      expect(res.status).toBe(403);
    });
  });

  describe("valid key via x-api-key header", () => {
    it("should authenticate and set context variables", async () => {
      vi.mocked(authModule.getAuth).mockReturnValue({
        api: {
          verifyApiKey: vi.fn().mockResolvedValue({
            valid: true,
            error: null,
            key: { referenceId: "user_123" },
          }),
        },
      } as any);

      mockDbQuery.limit.mockResolvedValueOnce([
        {
          userId: "user_123",
          smtpUsername: "enc_user",
          smtpPassword: "enc_pass",
          smtpHostName: "enc_host",
          senderEmail: "enc_email",
        },
      ]);

      const res = await app.request("/test", {
        headers: { "x-api-key": "mk.valid-key-123" },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        sender: string;
        userId: string;
      };
      expect(body.success).toBe(true);
      expect(body.sender).toBe("decrypted_enc_email");
      expect(body.userId).toBe("user_123");
    });

    it("should decrypt all SMTP credentials", async () => {
      vi.mocked(authModule.getAuth).mockReturnValue({
        api: {
          verifyApiKey: vi.fn().mockResolvedValue({
            valid: true,
            error: null,
            key: { referenceId: "u1" },
          }),
        },
      } as any);

      mockDbQuery.limit.mockResolvedValueOnce([
        {
          userId: "u1",
          smtpUsername: "enc_u",
          smtpPassword: "enc_p",
          smtpHostName: "enc_h",
          senderEmail: "enc_s",
        },
      ]);

      await app.request("/test", {
        headers: { "x-api-key": "mk.key" },
      });

      expect(cryptoModule.decrypt).toHaveBeenCalledTimes(4);
      expect(cryptoModule.decrypt).toHaveBeenCalledWith("enc_u", mockConfig.aesKey);
      expect(cryptoModule.decrypt).toHaveBeenCalledWith("enc_p", mockConfig.aesKey);
      expect(cryptoModule.decrypt).toHaveBeenCalledWith("enc_h", mockConfig.aesKey);
      expect(cryptoModule.decrypt).toHaveBeenCalledWith("enc_s", mockConfig.aesKey);
    });

    it("should query SMTP credentials by userId from Better Auth", async () => {
      vi.mocked(authModule.getAuth).mockReturnValue({
        api: {
          verifyApiKey: vi.fn().mockResolvedValue({
            valid: true,
            error: null,
            key: { referenceId: "u1" },
          }),
        },
      } as any);

      mockDbQuery.limit.mockResolvedValueOnce([
        {
          userId: "u1",
          smtpUsername: "e",
          smtpPassword: "e",
          smtpHostName: "e",
          senderEmail: "e",
        },
      ]);

      await app.request("/test", {
        headers: { "x-api-key": "mk.my-secret-key" },
      });

      expect(dbModule.createDatabase).toHaveBeenCalledWith(mockConfig.db);
      expect(mockDbQuery.where).toHaveBeenCalled();
    });
  });

  describe("valid key via Authorization Bearer header", () => {
    it("should authenticate with Bearer token", async () => {
      vi.mocked(authModule.getAuth).mockReturnValue({
        api: {
          verifyApiKey: vi.fn().mockResolvedValue({
            valid: true,
            error: null,
            key: { referenceId: "user_456" },
          }),
        },
      } as any);

      mockDbQuery.limit.mockResolvedValueOnce([
        {
          userId: "user_456",
          smtpUsername: "enc_u",
          smtpPassword: "enc_p",
          smtpHostName: "enc_h",
          senderEmail: "enc_s",
        },
      ]);

      const res = await app.request("/test", {
        headers: { Authorization: "Bearer mk.valid-key-456" },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { userId: string };
      expect(body.userId).toBe("user_456");
    });

    it("should trim trailing spaces from Bearer token", async () => {
      vi.mocked(authModule.getAuth).mockReturnValue({
        api: {
          verifyApiKey: vi.fn().mockResolvedValue({
            valid: true,
            error: null,
            key: { referenceId: "user_789" },
          }),
        },
      } as any);

      mockDbQuery.limit.mockResolvedValueOnce([
        {
          userId: "user_789",
          smtpUsername: "u",
          smtpPassword: "p",
          smtpHostName: "h",
          senderEmail: "e",
        },
      ]);

      const res = await app.request("/test", {
        headers: { Authorization: "Bearer mk.valid-key-789 " },
      });

      expect(res.status).toBe(200);
    });
  });

  describe("x-api-key takes precedence over Authorization", () => {
    it("should use x-api-key when both headers are present", async () => {
      vi.mocked(authModule.getAuth).mockReturnValue({
        api: {
          verifyApiKey: vi.fn().mockResolvedValue({
            valid: true,
            error: null,
            key: { referenceId: "user_from_header" },
          }),
        },
      } as any);

      mockDbQuery.limit.mockResolvedValueOnce([
        {
          userId: "user_from_header",
          smtpUsername: "u",
          smtpPassword: "p",
          smtpHostName: "h",
          senderEmail: "e",
        },
      ]);

      const res = await app.request("/test", {
        headers: {
          "x-api-key": "mk.primary-key",
          Authorization: "Bearer mk.secondary-key",
        },
      });

      expect(res.status).toBe(200);
      expect(mockDbQuery.where).toHaveBeenCalled();
    });
  });
});
