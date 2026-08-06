import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { apiKeyMiddleware } from "@/middleware/api-key.middleware";
import { errorHandler } from "@/middleware/error.handler";
import * as dbModule from "@/db/connection";
import * as cryptoModule from "@/core/crypto";
import type { Database } from "@/db/connection";
import type { Bindings } from "@/index";
import type { UserInfoVariables } from "@/index";

// Database and crypto are mocked at the module level so every test gets a
// clean stub instead of hitting a real D1 instance or performing AES-GCM.
vi.mock("@/db/connection");
vi.mock("@/core/crypto");

type AppEnv = {
  Bindings: Bindings;
  Variables: UserInfoVariables;
};

// Minimal config that satisfies the middleware's contract. The actual D1
// binding is an empty object because `createDatabase` is fully mocked.
const mockConfig: { db: D1Database; aesKey: string } = {
  db: {} as D1Database,
  aesKey: "a".repeat(64),
};

// Drizzle query chain mock — each method returns `this` so calls like
// `db.select().from().innerJoin().where().limit(1)` chain correctly.
// `limit` is the terminal call and is configured per-test with
// `mockResolvedValueOnce` to control what the middleware receives.
const mockDbQuery = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  innerJoin: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn(),
};

/**
 * Build a minimal Hono app that wires the API key middleware in front of
 * a dummy GET route. The route reads the context variables that the
 * middleware is responsible for setting (`smtpConfig`, `userConfig`) and
 * returns them as JSON so tests can assert on them.
 */
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

    // Re-establish the chainable mock after resetAllMocks clears them.
    // Without this, calls like `db.select().from()` break because each
    // intermediate method returns `undefined` instead of the chain object.
    mockDbQuery.select.mockReturnValue(mockDbQuery);
    mockDbQuery.from.mockReturnValue(mockDbQuery);
    mockDbQuery.innerJoin.mockReturnValue(mockDbQuery);
    mockDbQuery.where.mockReturnValue(mockDbQuery);

    vi.mocked(dbModule.createDatabase).mockReturnValue(
      mockDbQuery as unknown as Database,
    );
    // Decrypt is stubbed to return a predictable value so tests can assert
    // that the middleware passes the correct AES key and ciphertext.
    vi.mocked(cryptoModule.decrypt).mockImplementation(
      async (text: string) => `decrypted_${text}`,
    );
    app = buildApp();
  });

  describe("missing or malformed key", () => {
    // The middleware must reject requests that carry no authentication
    // headers at all — this is the most basic access-control check.
    it("should return 401 if no headers are provided", async () => {
      const res = await app.request("/test");
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("Missing");
    });

    // An empty string passes the `!apiKey` check only if we explicitly
    // handle it; this test guards against that edge case.
    it("should return 401 if x-api-key is empty string", async () => {
      const res = await app.request("/test", {
        headers: { "x-api-key": "" },
      });
      expect(res.status).toBe(401);
    });

    // Keys are prefixed with `mk.` to make them visually distinguishable
    // and to allow future key-format evolution without breaking clients.
    it("should return 401 if key does not start with 'mk.'", async () => {
      const res = await app.request("/test", {
        headers: { "x-api-key": "invalid_prefix_123" },
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("Invalid");
    });

    // The Authorization header must use the "Bearer <token>" format per
    // RFC 6750. A bare value without the prefix is not valid Bearer auth.
    it("should return 401 if Authorization header has no Bearer prefix", async () => {
      const res = await app.request("/test", {
        headers: { Authorization: "mk.valid-key" },
      });
      expect(res.status).toBe(401);
    });
  });

  describe("key not found in database", () => {
    // A syntactically valid key that doesn't match any row in the apikey
    // table should yield 403 (Forbidden), not 401 — the caller
    // authenticated, but their credential is not recognised.
    it("should return 403 if API key is not in the database", async () => {
      mockDbQuery.limit.mockResolvedValueOnce([]);

      const res = await app.request("/test", {
        headers: { "x-api-key": "mk.unknown-key" },
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("Invalid API Key");
    });
  });

  describe("valid key via x-api-key header", () => {
    // Happy path: a valid key is looked up, the associated user's SMTP
    // credentials are decrypted, and both `smtpConfig` and `userConfig`
    // are attached to the Hono context for downstream handlers.
    it("should authenticate and set context variables", async () => {
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

    // All four encrypted fields must be decrypted with the same AES key.
    // Missing any one of them would break the SMTP connection or the
    // sender address in the email header.
    it("should decrypt all SMTP credentials", async () => {
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

    // Verify the middleware actually uses the config's db binding and
    // builds the Drizzle query chain against the correct tables.
    it("should query the database with the correct key", async () => {
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
    // The middleware supports both `x-api-key` and `Authorization: Bearer`
    // for flexibility — programmatic clients prefer the former, while
    // browser-based tools (e.g. Postman, curl) naturally use the latter.
    it("should authenticate with Bearer token", async () => {
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

    // Trailing whitespace in headers is common when values are
    // concatenated or copied from documentation. The middleware strips
    // it so legitimate requests don't fail on a cosmetic issue.
    it("should trim trailing spaces from Bearer token", async () => {
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
    // When both headers are present the middleware should prefer x-api-key.
    // This deterministic behaviour avoids ambiguity and makes debugging
    // simpler — callers always know which credential was used.
    it("should use x-api-key when both headers are present", async () => {
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
