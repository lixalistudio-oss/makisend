import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import type { Context } from "hono";
import { errorHandler } from "@/middleware/error.handler";
import {
  IdempotencyRepository,
  IdempotencyService,
  idempotencyMiddleware,
} from "@/idempotency";
import { createDatabase } from "@/db/connection";
import { AppError } from "@/core/errors";
import { createTestD1, cleanupTestD1 } from "../../helpers/d1-setup";
import type { Bindings, UserInfoVariables } from "@/index";
import type { Miniflare } from "miniflare";

type AppEnv = {
  Bindings: Bindings;
  Variables: UserInfoVariables;
};

const BODY = JSON.stringify({ message: "hello" });

async function requestHash(body = BODY): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`POST\n/send-email\n${body}`),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

describe("idempotencyMiddleware", () => {
  let mf: Miniflare;
  let app: Hono<AppEnv>;
  let service: IdempotencyService;
  let handlerCalls: number;
  let handler: (c: Context<AppEnv>) => Response | Promise<Response>;

  beforeEach(async () => {
    handlerCalls = 0;
    const testD1 = await createTestD1();
    mf = testD1.mf;
    service = new IdempotencyService(
      new IdempotencyRepository(createDatabase(testD1.d1)),
    );

    handler = (c) => {
      handlerCalls += 1;
      return c.json({ success: true, emailId: `email-${handlerCalls}` }, 202);
    };

    app = new Hono<AppEnv>();
    app.onError(errorHandler);
    app.use("*", async (c, next) => {
      c.set("userId", "user-1");
      await next();
    });
    app.use("/send-email/*", idempotencyMiddleware(() => service));
    app.post("/send-email", (c) => handler(c));
  });

  afterEach(async () => {
    await cleanupTestD1(mf);
  });

  function request(headers: Record<string, string> = {}, body = BODY) {
    return app.request(
      "/send-email",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body,
      },
      {} as Bindings,
    );
  }

  it("runs the handler normally when no key is supplied", async () => {
    const first = await request();
    const second = await request();

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(handlerCalls).toBe(2);
    expect(await second.json()).toMatchObject({ emailId: "email-2" });
  });

  it("replays the stored response for the same key and body", async () => {
    const first = await request({ "Idempotency-Key": "key-1" });
    const second = await request({ "Idempotency-Key": "key-1" });

    expect(first.status).toBe(202);
    expect(first.headers.get("Idempotency-Replayed")).toBe("false");
    expect(second.status).toBe(202);
    expect(second.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await first.json()).toEqual(await second.json());
    expect(handlerCalls).toBe(1);
  });

  it("rejects the same key with a different body", async () => {
    await request({ "Idempotency-Key": "key-2" });
    const conflict = await request(
      { "Idempotency-Key": "key-2" },
      JSON.stringify({ message: "different" }),
    );

    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      error: expect.stringContaining("different request body"),
    });
    expect(handlerCalls).toBe(1);
  });

  it("rejects a key that is already in progress", async () => {
    const decision = await service.begin({
      userId: "user-1",
      route: "/send-email",
      key: "key-3",
      requestHash: await requestHash(),
    });
    expect(decision.type).toBe("proceed");

    const response = await request({ "Idempotency-Key": "key-3" });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("in progress"),
    });
    expect(handlerCalls).toBe(0);
  });

  it("does not cache a 5xx response", async () => {
    handler = () => {
      handlerCalls += 1;
      throw new AppError(500, "temporary failure");
    };

    const first = await request({ "Idempotency-Key": "key-4" });
    const second = await request({ "Idempotency-Key": "key-4" });

    expect(first.status).toBe(500);
    expect(second.status).toBe(500);
    expect(handlerCalls).toBe(2);
  });

  it("validates the key length and characters", async () => {
    const tooLong = await request({
      "Idempotency-Key": "a".repeat(256),
    });
    const invalid = await request({
      "Idempotency-Key": "has spaces",
    });

    expect(tooLong.status).toBe(400);
    expect(invalid.status).toBe(400);
    expect(handlerCalls).toBe(0);
  });

  it("does not apply to non-POST requests", async () => {
    app.get("/send-email", (c) => {
      handlerCalls += 1;
      return c.json({ ok: true });
    });

    const first = await app.request(
      "/send-email",
      { headers: { "Idempotency-Key": "key-get" } },
      {} as Bindings,
    );
    const second = await app.request(
      "/send-email",
      { headers: { "Idempotency-Key": "key-get" } },
      {} as Bindings,
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(handlerCalls).toBe(2);
  });
});
