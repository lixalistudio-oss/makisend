import { describe, it, expect, vi } from "vitest";
import { Webhook } from "standardwebhooks";
import { encrypt } from "@/core/crypto";
import {
  classifyStatus,
  deliverOnce,
  parseRetryAfter,
  signingSecrets,
  webhookIdFor,
  WEBHOOK_USER_AGENT,
} from "@/webhooks/webhook-delivery";
import { generateSecret } from "@/webhooks/webhook-signature";

const BODY = JSON.stringify({ type: "webhook.test", data: { endpointId: "ep-1" } });

function fetchReturning(response: Response | (() => Promise<Response>)) {
  return vi.fn(async () => (typeof response === "function" ? response() : response)) as unknown as typeof fetch & {
    mock: { calls: [string, RequestInit][] };
  };
}

describe("classifyStatus (api design §6.6)", () => {
  it.each([200, 201, 202, 204, 299])("%i is delivered", (status) => expect(classifyStatus(status)).toBe("delivered"));
  it.each([500, 502, 503, 504, 599, 408, 409, 425, 429])("%i is retried", (status) => expect(classifyStatus(status)).toBe("retry"));
  it.each([301, 302, 307, 308, 400, 401, 403, 404, 410, 413, 422])("%i is abandoned", (status) =>
    expect(classifyStatus(status)).toBe("failed"),
  );
});

describe("parseRetryAfter", () => {
  const now = new Date("2026-11-11T10:00:00.000Z");
  it("reads seconds and HTTP dates, caps at 12 h, ignores garbage", () => {
    expect(parseRetryAfter("120", now)).toBe(120);
    expect(parseRetryAfter("Wed, 11 Nov 2026 10:05:00 GMT", now)).toBe(300);
    expect(parseRetryAfter("999999", now)).toBe(43_200);
    expect(parseRetryAfter("soon", now)).toBeNull();
    expect(parseRetryAfter(null, now)).toBeNull();
  });
});

describe("deliverOnce", () => {
  const secret = generateSecret();
  const input = { url: "https://hooks.example.com/in", secrets: [secret], webhookId: "msg_d1", body: BODY };

  it("POSTs the exact body with Standard Webhooks headers the official library verifies", async () => {
    const fetchMock = fetchReturning(new Response(null, { status: 204 }));
    const result = await deliverOnce(input, { fetch: fetchMock });

    expect(result).toEqual({ verdict: "delivered", statusCode: 204, error: null, durationMs: expect.any(Number), retryAfterSeconds: null });
    const [url, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Record<string, string>;
    expect(url).toBe("https://hooks.example.com/in");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(BODY);
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["User-Agent"]).toBe(WEBHOOK_USER_AGENT);
    expect(headers["webhook-id"]).toBe("msg_d1");
    expect(() => new Webhook(secret).verify(BODY, headers)).not.toThrow();
  });

  it("does not follow a redirect: a 3xx is a failure, reported by status", async () => {
    const result = await deliverOnce(input, {
      fetch: fetchReturning(new Response(null, { status: 302, headers: { Location: "http://169.254.169.254/" } })),
    });
    expect(result).toMatchObject({ verdict: "failed", statusCode: 302, error: "HTTP 302" });
  });

  it("a 404 is abandoned, a 500 retried", async () => {
    expect((await deliverOnce(input, { fetch: fetchReturning(new Response("nope", { status: 404 })) })).verdict).toBe("failed");
    expect((await deliverOnce(input, { fetch: fetchReturning(new Response("boom", { status: 500 })) })).verdict).toBe("retry");
  });

  it("a 429 is retried after its Retry-After", async () => {
    const result = await deliverOnce(input, {
      fetch: fetchReturning(new Response(null, { status: 429, headers: { "Retry-After": "90" } })),
    });
    expect(result).toMatchObject({ verdict: "retry", statusCode: 429, retryAfterSeconds: 90 });
  });

  it("a timeout and a network error are retried, with no status", async () => {
    const timeout = vi.fn(async () => {
      throw Object.assign(new Error("The operation timed out."), { name: "TimeoutError" });
    }) as unknown as typeof fetch;
    const network = vi.fn(async () => {
      throw new TypeError("fetch failed: ECONNREFUSED 10.0.0.1:443");
    }) as unknown as typeof fetch;

    expect(await deliverOnce(input, { fetch: timeout })).toMatchObject({ verdict: "retry", statusCode: null, error: "timeout" });
    const failed = await deliverOnce(input, { fetch: network });
    expect(failed).toMatchObject({ verdict: "retry", statusCode: null, error: "network error" });
    expect(JSON.stringify(failed)).not.toContain("10.0.0.1");
  });

  it("times out a receiver that never answers", async () => {
    const hanging = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    ) as unknown as typeof fetch;
    const result = await deliverOnce(input, { fetch: hanging, timeoutMs: 20 });
    expect(result).toMatchObject({ verdict: "retry", error: "timeout" });
  });

  it("never returns or keeps the response body", async () => {
    const result = await deliverOnce(input, {
      fetch: fetchReturning(new Response("<html>admin panel, password=hunter2</html>", { status: 500 })),
    });
    expect(JSON.stringify(result)).not.toContain("hunter2");
  });

  it("signs with every given secret, so both verify during a rotation", async () => {
    const previous = generateSecret();
    const fetchMock = fetchReturning(new Response(null, { status: 200 }));
    await deliverOnce({ ...input, secrets: [secret, previous] }, { fetch: fetchMock });
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["webhook-signature"].split(" ")).toHaveLength(2);
    expect(() => new Webhook(previous).verify(BODY, headers)).not.toThrow();
  });
});

describe("signingSecrets", () => {
  const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const now = new Date("2026-11-12T10:00:00.000Z");

  it("adds the previous secret only inside its window", async () => {
    const endpoint = {
      secret: await encrypt("whsec_new", KEY),
      previousSecret: await encrypt("whsec_old", KEY),
      previousSecretExpiresAt: new Date("2026-11-12T11:00:00.000Z"),
    };
    expect(await signingSecrets(endpoint, KEY, now)).toEqual(["whsec_new", "whsec_old"]);
    expect(await signingSecrets({ ...endpoint, previousSecretExpiresAt: new Date("2026-11-12T09:00:00.000Z") }, KEY, now)).toEqual([
      "whsec_new",
    ]);
    expect(await signingSecrets({ ...endpoint, previousSecret: null }, KEY, now)).toEqual(["whsec_new"]);
  });

  it("webhook-id is msg_<delivery id>", () => {
    expect(webhookIdFor("abc")).toBe("msg_abc");
  });
});
