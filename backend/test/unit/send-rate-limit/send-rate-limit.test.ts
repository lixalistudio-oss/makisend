/**
 * Optional per-API-key send quota (SEND_RATE_LIMIT), against a real D1 (Miniflare).
 *
 *  R1  The variable: unset/empty is "no quota"; `<count>/<unit>` parses; anything else fails loudly.
 *  R2  No quota configured: the middleware lets every send through and writes nothing.
 *  R3  A quota: `max` sends pass, the next one is a 429 with Retry-After, counted per key.
 *  R4  The window restarts once it is over.
 *  R5  The counter is atomic: concurrent sends on one key never exceed `max`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { Miniflare } from "miniflare";
import { createDatabase, type Database } from "@/db/connection";
import { apikey, sendRateLimit, user } from "@/db/schema";
import { AppError } from "@/core/errors";
import { errorHandler } from "@/middleware/error.handler";
import type { Bindings, UserInfoVariables } from "@/index";
import {
  INVALID_SEND_RATE_LIMIT,
  parseSendRateLimit,
  SendRateLimitRepository,
  sendRateLimitMiddleware,
  type SendRateLimit,
} from "@/send-rate-limit";
import { cleanupTestD1, createTestD1 } from "../../helpers/d1-setup";

type AppEnv = { Bindings: Bindings; Variables: UserInfoVariables };

describe("R1 parseSendRateLimit", () => {
  it("unset or blank means no quota", () => {
    expect(parseSendRateLimit(undefined)).toBeNull();
    expect(parseSendRateLimit("")).toBeNull();
    expect(parseSendRateLimit("   ")).toBeNull();
  });

  it("reads <count>/<unit> in seconds, minutes, hours and days", () => {
    expect(parseSendRateLimit("100/min")).toEqual({ max: 100, windowMs: 60_000, label: "100/min" });
    expect(parseSendRateLimit("10/s")).toEqual({ max: 10, windowMs: 1_000, label: "10/s" });
    expect(parseSendRateLimit(" 500 / hour ")).toEqual({ max: 500, windowMs: 3_600_000, label: "500/hour" });
    expect(parseSendRateLimit("5000/DAY")?.windowMs).toBe(86_400_000);
  });

  it("refuses anything else instead of sending without a limit", () => {
    for (const bad of ["100", "0/min", "-5/min", "1.5/min", "100/week", "abc/min", "100/"]) {
      expect(() => parseSendRateLimit(bad), bad).toThrow(new AppError(500, INVALID_SEND_RATE_LIMIT));
    }
  });
});

describe("send rate limit middleware (real D1)", () => {
  let mf: Miniflare;
  let db: Database;
  let repository: SendRateLimitRepository;
  let clock: number;
  let limit: SendRateLimit | null;
  let handlerCalls: number;
  let app: Hono<AppEnv>;

  async function seedKey(id: string) {
    await db.insert(apikey).values({
      id,
      referenceId: "user-1",
      key: `hash-${id}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  beforeEach(async () => {
    const testD1 = await createTestD1();
    mf = testD1.mf;
    db = createDatabase(testD1.d1);
    repository = new SendRateLimitRepository(db);
    clock = 1_000_000;
    limit = null;
    handlerCalls = 0;

    await db.insert(user).values({
      id: "user-1",
      name: "Admin",
      email: "admin@example.com",
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await seedKey("key-a");
    await seedKey("key-b");

    app = new Hono<AppEnv>();
    app.onError(errorHandler);
    app.use("*", async (c, next) => {
      c.set("apiKeyId", c.req.header("x-test-key") ?? "key-a");
      await next();
    });
    app.use("/send-email/*", sendRateLimitMiddleware(() => limit, () => repository, () => clock));
    app.post("/send-email", (c) => {
      handlerCalls += 1;
      return c.json({ success: true }, 202);
    });
  });

  afterEach(async () => {
    await cleanupTestD1(mf);
  });

  const send = (key = "key-a") =>
    app.request("/send-email", { method: "POST", headers: { "x-test-key": key } }, {} as Bindings);

  it("R2 without a quota every send passes and nothing is stored", async () => {
    for (let i = 0; i < 5; i++) expect((await send()).status).toBe(202);
    expect(handlerCalls).toBe(5);
    expect(await db.select().from(sendRateLimit)).toEqual([]);
  });

  it("R3 lets `max` sends through, then answers 429 with Retry-After, per key", async () => {
    limit = parseSendRateLimit("2/min");

    const first = await send();
    expect(first.status).toBe(202);
    expect(first.headers.get("RateLimit-Limit")).toBe("2");
    expect(first.headers.get("RateLimit-Remaining")).toBe("1");
    expect((await send()).status).toBe(202);

    clock += 15_000;
    const refused = await send();
    expect(refused.status).toBe(429);
    expect(refused.headers.get("Retry-After")).toBe("45");
    expect(refused.headers.get("RateLimit-Remaining")).toBe("0");
    expect(await refused.json()).toEqual({
      success: false,
      error: "Send rate limit reached for this API key (2/min). Retry in 45 s.",
    });
    expect(handlerCalls).toBe(2);

    // Another key has its own counter.
    expect((await send("key-b")).status).toBe(202);
  });

  it("R4 the window restarts once it is over", async () => {
    limit = parseSendRateLimit("1/min");
    expect((await send()).status).toBe(202);
    expect((await send()).status).toBe(429);

    clock += 60_000;
    expect((await send()).status).toBe(202);
    expect(await db.select().from(sendRateLimit)).toEqual([{ apiKeyId: "key-a", windowStart: clock, count: 1 }]);
  });

  it("R5 concurrent sends on one key never exceed the quota", async () => {
    limit = parseSendRateLimit("5/min");
    const statuses = (await Promise.all(Array.from({ length: 12 }, () => send()))).map((r) => r.status);
    expect(statuses.filter((s) => s === 202)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(7);
  });

  it("deleting the API key deletes its counter", async () => {
    limit = parseSendRateLimit("5/min");
    await send();
    await db.delete(apikey);
    expect(await db.select().from(sendRateLimit)).toEqual([]);
  });
});
