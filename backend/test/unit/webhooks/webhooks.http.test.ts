import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { Webhook } from "standardwebhooks";
import { createTestD1, cleanupTestD1 } from "../../helpers/d1-setup";
import { decrypt, encrypt } from "@/core/crypto";
import { app } from "@/index";
import type { Bindings } from "@/index";

const ORIGIN = "http://localhost:4321";
const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

// deps.initDb() is a one-shot module singleton, so the whole file shares one D1.
// MakiSend has a single account (owner lock): "another user" is inserted straight into D1.
let env: Bindings;
let mf: Parameters<typeof cleanupTestD1>[0];
let d1: D1Database;
let cookie = "";
const queueSend = vi.fn();

const PUBLIC_ENDPOINT_KEYS = ["createdAt", "disabledReason", "enabled", "id", "rotationEndsAt", "updatedAt", "url"];

function call(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}) {
  const headers: Record<string, string> = { Origin: ORIGIN };
  if (init.auth !== false) headers.Cookie = cookie;
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(
    path,
    {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    },
    env,
  );
}

/** The `endpoint` of a `{ endpoint }` response. */
async function endpointOf(res: Response) {
  return ((await res.json()) as { endpoint: { url: string; rotationEndsAt: string | null } & Record<string, unknown> })
    .endpoint;
}

async function createEndpoint(url: string) {
  const res = await call("/webhooks", { method: "POST", body: { url } });
  expect(res.status).toBe(201);
  return (await res.json()) as { endpoint: { id: string; url: string; rotationEndsAt: string | null }; secret: string };
}

describe("Webhooks HTTP", () => {
  beforeAll(async () => {
    const testD1 = await createTestD1();
    mf = testD1.mf;
    d1 = testD1.d1;
    env = {
      AES_256_KEY: KEY,
      makisend_db: d1,
      BETTER_AUTH_SECRET: "test-secret",
      BETTER_AUTH_URL: "http://localhost:8787",
      FRONTEND_URL: ORIGIN,
      WEBHOOK_QUEUE: { send: queueSend, sendBatch: vi.fn() },
    } as unknown as Bindings;

    const res = await app.request(
      "/api/auth/sign-up/email",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGIN },
        body: JSON.stringify({ email: "owner@example.com", password: "password123" }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const h = res.headers as Headers & { getSetCookie?: () => string[] };
    const cookies = h.getSetCookie ? h.getSetCookie() : [h.get("set-cookie")];
    cookie = cookies.map((c) => (c ?? "").split(";")[0]).join("; ");
    expect(cookie).toContain("session_token");

    await d1
      .prepare(`INSERT INTO "user" (id, email, email_verified, created_at, updated_at) VALUES ('stranger', 's@x.y', 1, 0, 0)`)
      .run();
  });

  afterAll(async () => {
    await cleanupTestD1(mf);
  });

  beforeEach(async () => {
    await d1.prepare(`DELETE FROM "webhook_endpoints"`).run();
  });

  describe("authentication", () => {
    it.each([
      ["GET", "/webhooks"],
      ["POST", "/webhooks"],
      ["GET", "/webhooks/some-id"],
      ["PUT", "/webhooks/some-id"],
      ["DELETE", "/webhooks/some-id"],
      ["POST", "/webhooks/some-id/rotate-secret"],
      ["GET", "/webhooks/some-id/deliveries"],
      ["POST", "/webhooks/some-id/test"],
      ["POST", "/webhooks/some-id/deliveries/d1/retry"],
    ])("%s %s answers 401 without a session", async (method, path) => {
      const res = await call(path, { method, auth: false, body: method === "GET" || method === "DELETE" ? undefined : {} });
      expect(res.status).toBe(401);
    });
  });

  describe("POST /webhooks", () => {
    it("creates an endpoint and returns the secret once, next to the public view", async () => {
      const res = await call("/webhooks", { method: "POST", body: { url: "https://App.Example.com/hooks#frag" } });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { endpoint: Record<string, unknown>; secret: string };

      expect(Object.keys(body).sort()).toEqual(["endpoint", "secret"]);
      expect(Object.keys(body.endpoint).sort()).toEqual(PUBLIC_ENDPOINT_KEYS);
      expect(body.endpoint).toMatchObject({
        url: "https://app.example.com/hooks",
        enabled: true,
        disabledReason: null,
        rotationEndsAt: null,
      });
      expect(body.secret).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/);
    });

    it("stores the URL and the secret encrypted", async () => {
      const { endpoint, secret } = await createEndpoint("https://app.example.com/hooks?token=abc");
      const row = await d1
        .prepare(`SELECT url, secret FROM "webhook_endpoints" WHERE id = ?1`)
        .bind(endpoint.id)
        .first<{ url: string; secret: string }>();

      expect(row!.url).not.toContain("example.com");
      expect(row!.secret).not.toContain("whsec_");
      expect(await decrypt(row!.url, KEY)).toBe("https://app.example.com/hooks?token=abc");
      expect(await decrypt(row!.secret, KEY)).toBe(secret);
    });

    it("answers 400 Validation failed for an unknown field or a missing url", async () => {
      for (const body of [{ url: "https://a.example.com/", secret: "whsec_mine" }, {}]) {
        const res = await call("/webhooks", { method: "POST", body });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: "Validation failed", details: expect.any(Object) });
      }
    });

    it("answers 400 WEBHOOK_URL_INVALID with the reason for a refused URL", async () => {
      const res = await call("/webhooks", { method: "POST", body: { url: "https://169.254.169.254/latest" } });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        code: "WEBHOOK_URL_INVALID",
        error: "This address points to a private network.",
      });
    });

    it("answers 409 WEBHOOK_URL_EXISTS for the same URL written differently", async () => {
      await createEndpoint("https://a.example.com/hook");
      const res = await call("/webhooks", { method: "POST", body: { url: "HTTPS://A.EXAMPLE.COM/hook#x" } });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "WEBHOOK_URL_EXISTS" });
    });

    it("answers 409 WEBHOOK_LIMIT_REACHED at the 6th endpoint", async () => {
      for (let i = 0; i < 5; i++) await createEndpoint(`https://a.example.com/hook-${i}`);
      const res = await call("/webhooks", { method: "POST", body: { url: "https://a.example.com/hook-6" } });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({
        code: "WEBHOOK_LIMIT_REACHED",
        error: "You can register up to 5 webhook endpoints.",
      });
    });
  });

  describe("GET /webhooks and GET /webhooks/:id", () => {
    it("lists and reads the endpoints with no secret anywhere in the response", async () => {
      const { endpoint } = await createEndpoint("https://a.example.com/");
      await call(`/webhooks/${endpoint.id}/rotate-secret`, { method: "POST", body: {} });

      const list = await call("/webhooks");
      const listText = await list.text();
      expect(list.status).toBe(200);
      expect(JSON.parse(listText).endpoints).toHaveLength(1);
      expect(listText).not.toContain("whsec_");
      expect(listText).not.toMatch(/secret"/i);

      const one = await call(`/webhooks/${endpoint.id}`);
      const oneText = await one.text();
      expect(one.status).toBe(200);
      expect(Object.keys(JSON.parse(oneText).endpoint).sort()).toEqual(PUBLIC_ENDPOINT_KEYS);
      expect(oneText).not.toContain("whsec_");
    });

    it("answers 404 WEBHOOK_NOT_FOUND for an unknown id", async () => {
      const res = await call("/webhooks/does-not-exist");
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: "WEBHOOK_NOT_FOUND" });
    });
  });

  describe("another user's endpoint", () => {
    it("answers the same 404 as an unknown id on every route, and changes nothing", async () => {
      await d1
        .prepare(`INSERT INTO "webhook_endpoints" (id, user_id, url, secret) VALUES ('foreign', 'stranger', ?1, ?2)`)
        .bind(await encrypt("https://stranger.example.com/", KEY), await encrypt("whsec_x", KEY))
        .run();

      const attempts = [
        call("/webhooks/foreign"),
        call("/webhooks/foreign", { method: "PUT", body: { enabled: false } }),
        call("/webhooks/foreign/rotate-secret", { method: "POST", body: {} }),
        call("/webhooks/foreign/deliveries"),
        call("/webhooks/foreign", { method: "DELETE" }),
      ];
      for (const res of await Promise.all(attempts)) {
        expect(res.status).toBe(404);
        expect(await res.json()).toMatchObject({ code: "WEBHOOK_NOT_FOUND", error: "Webhook endpoint not found." });
      }

      const list = (await (await call("/webhooks")).json()) as { endpoints: unknown[] };
      expect(list.endpoints).toEqual([]);
      const row = await d1.prepare(`SELECT enabled FROM "webhook_endpoints" WHERE id = 'foreign'`).first<{ enabled: number }>();
      expect(row?.enabled).toBe(1);
    });
  });

  describe("PUT /webhooks/:id", () => {
    it("disables and re-enables an endpoint", async () => {
      const { endpoint } = await createEndpoint("https://a.example.com/");

      const off = await call(`/webhooks/${endpoint.id}`, { method: "PUT", body: { enabled: false } });
      expect(off.status).toBe(200);
      expect(await endpointOf(off)).toMatchObject({ enabled: false, disabledReason: "manual" });

      await d1.prepare(`UPDATE "webhook_endpoints" SET disabled_reason = 'auto', consecutive_failures = 20`).run();
      const on = await call(`/webhooks/${endpoint.id}`, { method: "PUT", body: { enabled: true } });
      expect(await endpointOf(on)).toMatchObject({ enabled: true, disabledReason: null });
      const row = await d1.prepare(`SELECT consecutive_failures FROM "webhook_endpoints"`).first<{ consecutive_failures: number }>();
      expect(row?.consecutive_failures).toBe(0);
    });

    it("changes the URL without changing the secret", async () => {
      const { endpoint, secret } = await createEndpoint("https://a.example.com/");
      const res = await call(`/webhooks/${endpoint.id}`, { method: "PUT", body: { url: "https://b.example.com/v2" } });
      expect(res.status).toBe(200);
      expect((await endpointOf(res)).url).toBe("https://b.example.com/v2");

      const row = await d1.prepare(`SELECT secret FROM "webhook_endpoints"`).first<{ secret: string }>();
      expect(await decrypt(row!.secret, KEY)).toBe(secret);
    });

    it("answers 400 for an empty body, a secret field, or a refused URL", async () => {
      const { endpoint } = await createEndpoint("https://a.example.com/");
      for (const body of [{}, { secret: "whsec_mine" }, { enabled: "yes" }]) {
        const res = await call(`/webhooks/${endpoint.id}`, { method: "PUT", body });
        expect(res.status).toBe(400);
      }
      const refused = await call(`/webhooks/${endpoint.id}`, { method: "PUT", body: { url: "http://a.example.com/" } });
      expect(await refused.json()).toMatchObject({ code: "WEBHOOK_URL_INVALID", error: "Webhook URLs must use https." });
    });

    it("answers 409 when the URL belongs to another endpoint of the user", async () => {
      const { endpoint } = await createEndpoint("https://a.example.com/");
      await createEndpoint("https://b.example.com/");
      const res = await call(`/webhooks/${endpoint.id}`, { method: "PUT", body: { url: "https://b.example.com/" } });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "WEBHOOK_URL_EXISTS" });
    });
  });

  describe("DELETE /webhooks/:id", () => {
    it("answers 204 with no body, deletes the log, then 404", async () => {
      const { endpoint } = await createEndpoint("https://a.example.com/");
      await d1
        .prepare(`INSERT INTO "webhook_deliveries" (id, endpoint_id, email_id, event_type) VALUES ('d1', ?1, 'e1', 'email.sent')`)
        .bind(endpoint.id)
        .run();

      const res = await call(`/webhooks/${endpoint.id}`, { method: "DELETE" });
      expect(res.status).toBe(204);
      expect(await res.text()).toBe("");

      expect((await call(`/webhooks/${endpoint.id}`)).status).toBe(404);
      expect((await call(`/webhooks/${endpoint.id}`, { method: "DELETE" })).status).toBe(404);
      const left = await d1.prepare(`SELECT COUNT(*) AS n FROM "webhook_deliveries"`).first<{ n: number }>();
      expect(left?.n).toBe(0);
    });
  });

  describe("POST /webhooks/:id/rotate-secret", () => {
    it("returns a new secret and a rotation window of 24 h", async () => {
      const { endpoint, secret } = await createEndpoint("https://a.example.com/");
      const before = Date.now();

      const res = await call(`/webhooks/${endpoint.id}/rotate-secret`, { method: "POST", body: { expireCurrentNow: false } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { endpoint: { rotationEndsAt: string }; secret: string };

      expect(body.secret).toMatch(/^whsec_/);
      expect(body.secret).not.toBe(secret);
      const ends = new Date(body.endpoint.rotationEndsAt).getTime();
      expect(ends - before).toBeGreaterThan(24 * 3600 * 1000 - 60_000);
      expect(ends - before).toBeLessThanOrEqual(24 * 3600 * 1000 + 60_000);

      const row = await d1.prepare(`SELECT secret, previous_secret FROM "webhook_endpoints"`).first<{ secret: string; previous_secret: string }>();
      expect(await decrypt(row!.secret, KEY)).toBe(body.secret);
      expect(await decrypt(row!.previous_secret, KEY)).toBe(secret);
    });

    it("works without a body, and expireCurrentNow ends the old secret at once", async () => {
      const { endpoint } = await createEndpoint("https://a.example.com/");
      const noBody = await call(`/webhooks/${endpoint.id}/rotate-secret`, { method: "POST" });
      expect(noBody.status).toBe(200);

      const res = await call(`/webhooks/${endpoint.id}/rotate-secret`, { method: "POST", body: { expireCurrentNow: true } });
      expect((await endpointOf(res)).rotationEndsAt).toBeNull();
      const row = await d1.prepare(`SELECT previous_secret FROM "webhook_endpoints"`).first<{ previous_secret: string | null }>();
      expect(row?.previous_secret).toBeNull();
    });

    it("answers 400 for an unknown field", async () => {
      const { endpoint } = await createEndpoint("https://a.example.com/");
      const res = await call(`/webhooks/${endpoint.id}/rotate-secret`, { method: "POST", body: { secret: "x" } });
      expect(res.status).toBe(400);
    });
  });

  describe("GET /webhooks/:id/deliveries", () => {
    it("pages the log newest first, filters by status and follows nextCursor", async () => {
      const { endpoint } = await createEndpoint("https://a.example.com/");
      const insert = d1.prepare(
        `INSERT INTO "webhook_deliveries" (id, endpoint_id, email_id, event_type, status, attempts, last_status_code, created_at)
         VALUES (?1, ?2, ?3, 'email.sent', ?4, 1, 200, ?5)`,
      );
      await d1.batch([
        insert.bind("d1", endpoint.id, "e1", "delivered", 1000),
        insert.bind("d2", endpoint.id, "e2", "failed", 2000),
        insert.bind("d3", endpoint.id, "e3", "delivered", 3000),
      ]);

      const first = await call(`/webhooks/${endpoint.id}/deliveries?limit=2`);
      expect(first.status).toBe(200);
      const page1 = (await first.json()) as { deliveries: { id: string; createdAt: string }[]; nextCursor: string };
      expect(page1.deliveries.map((d) => d.id)).toEqual(["d3", "d2"]);
      expect(page1.deliveries[0]).toEqual({
        id: "d3",
        eventType: "email.sent",
        emailId: "e3",
        status: "delivered",
        attempts: 1,
        lastStatusCode: 200,
        lastError: null,
        lastAttemptAt: null,
        deliveredAt: null,
        createdAt: new Date(3000).toISOString(),
      });

      const second = await call(`/webhooks/${endpoint.id}/deliveries?limit=2&cursor=${encodeURIComponent(page1.nextCursor)}`);
      const page2 = (await second.json()) as { deliveries: { id: string }[]; nextCursor: string | null };
      expect(page2.deliveries.map((d) => d.id)).toEqual(["d1"]);
      expect(page2.nextCursor).toBeNull();

      const failed = await call(`/webhooks/${endpoint.id}/deliveries?status=failed`);
      expect(((await failed.json()) as { deliveries: { id: string }[] }).deliveries.map((d) => d.id)).toEqual(["d2"]);
    });

    it("answers 400 for an invalid parameter", async () => {
      const { endpoint } = await createEndpoint("https://a.example.com/");
      for (const query of ["limit=0", "limit=101", "status=sent", "other=1", "cursor=%25%25"]) {
        const res = await call(`/webhooks/${endpoint.id}/deliveries?${query}`);
        expect(res.status, query).toBe(400);
      }
    });
  });

  describe("POST /webhooks/:id/test", () => {
    let received: { url: string; headers: Record<string, string>; body: string }[];
    let status: number;

    beforeEach(() => {
      received = [];
      status = 200;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init: RequestInit) => {
          received.push({ url, headers: init.headers as Record<string, string>, body: init.body as string });
          return new Response("receiver page with private data", { status });
        }),
      );
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("sends a signed webhook.test and answers 200 with the result, never the receiver's body", async () => {
      const { endpoint, secret } = await createEndpoint("https://receiver.example.com/hook");
      const res = await call(`/webhooks/${endpoint.id}/test`, { method: "POST" });
      const text = await res.text();

      expect(res.status).toBe(200);
      expect(JSON.parse(text)).toEqual({ ok: true, statusCode: 200, error: null, durationMs: expect.any(Number) });
      expect(text).not.toContain("private data");
      expect(received).toHaveLength(1);
      expect(received[0].url).toBe("https://receiver.example.com/hook");
      expect(new Webhook(secret).verify(received[0].body, received[0].headers)).toMatchObject({ type: "webhook.test" });

      const log = (await (await call(`/webhooks/${endpoint.id}/deliveries`)).json()) as { deliveries: unknown[] };
      expect(log.deliveries).toEqual([
        expect.objectContaining({ eventType: "webhook.test", emailId: null, status: "delivered", lastStatusCode: 200 }),
      ]);
    });

    it("answers 200 with ok: false when the receiver fails", async () => {
      const { endpoint } = await createEndpoint("https://receiver.example.com/hook");
      status = 503;
      const res = await call(`/webhooks/${endpoint.id}/test`, { method: "POST" });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: false, statusCode: 503, error: "HTTP 503" });
    });

    it("answers 429 WEBHOOK_TEST_RATE_LIMITED with Retry-After after 5 tests in a minute", async () => {
      const { endpoint } = await createEndpoint("https://receiver.example.com/hook");
      for (let i = 0; i < 5; i++) {
        expect((await call(`/webhooks/${endpoint.id}/test`, { method: "POST" })).status).toBe(200);
      }
      const res = await call(`/webhooks/${endpoint.id}/test`, { method: "POST" });
      expect(res.status).toBe(429);
      expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(await res.json()).toMatchObject({ code: "WEBHOOK_TEST_RATE_LIMITED" });
      expect(received).toHaveLength(5);
    });

    it("answers 404 for an unknown endpoint, without any outgoing request", async () => {
      const res = await call("/webhooks/unknown/test", { method: "POST" });
      expect(res.status).toBe(404);
      expect(received).toEqual([]);
    });
  });

  describe("POST /webhooks/:id/deliveries/:deliveryId/retry", () => {
    beforeEach(() => {
      queueSend.mockReset();
      queueSend.mockResolvedValue(undefined);
    });

    const insertDelivery = (id: string, endpointId: string, status: string) =>
      d1
        .prepare(
          `INSERT INTO "webhook_deliveries" (id, endpoint_id, email_id, event_type, status, attempts, last_error) VALUES (?1, ?2, ?3, 'email.sent', ?4, 8, 'HTTP 500')`,
        )
        .bind(id, endpointId, `email-${id}`, status)
        .run();

    it("puts a failed delivery back in the queue and answers 202 with it pending", async () => {
      const { endpoint } = await createEndpoint("https://a.example.com/");
      await insertDelivery("r1", endpoint.id, "failed");

      const res = await call(`/webhooks/${endpoint.id}/deliveries/r1/retry`, { method: "POST" });
      expect(res.status).toBe(202);
      expect(await res.json()).toMatchObject({ delivery: { id: "r1", status: "pending", attempts: 0, lastError: null } });
      expect(queueSend).toHaveBeenCalledExactlyOnceWith({ deliveryId: "r1" });

      const again = await call(`/webhooks/${endpoint.id}/deliveries/r1/retry`, { method: "POST" });
      expect(again.status).toBe(409);
      expect(await again.json()).toMatchObject({ code: "WEBHOOK_DELIVERY_NOT_FAILED" });
    });

    it("answers 404 WEBHOOK_DELIVERY_NOT_FOUND for an unknown delivery or one of another endpoint", async () => {
      const { endpoint } = await createEndpoint("https://a.example.com/");
      const { endpoint: other } = await createEndpoint("https://b.example.com/");
      await insertDelivery("r2", other.id, "failed");

      for (const path of [`/webhooks/${endpoint.id}/deliveries/nope/retry`, `/webhooks/${endpoint.id}/deliveries/r2/retry`]) {
        const res = await call(path, { method: "POST" });
        expect(res.status).toBe(404);
        expect(await res.json()).toMatchObject({ code: "WEBHOOK_DELIVERY_NOT_FOUND" });
      }
      expect(queueSend).not.toHaveBeenCalled();
    });
  });
});
