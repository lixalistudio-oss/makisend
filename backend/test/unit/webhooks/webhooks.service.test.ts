import { describe, it, expect, beforeEach, vi } from "vitest";
import { decrypt, encrypt } from "@/core/crypto";
import { AppError } from "@/core/errors";
import { Webhook } from "standardwebhooks";
import {
  WebhookRateLimitedError,
  WebhooksService,
  decodeDeliveryCursor,
  encodeDeliveryCursor,
} from "@/webhooks/webhooks.service";
import type {
  IWebhookRepository,
  ListDeliveriesFilter,
  WebhookDeliveryRecord,
  WebhookDeliveryUpdate,
  WebhookEndpointRecord,
} from "@/webhooks/webhooks.types";

vi.mock("@/core/logger", () => ({
  pinoLogger: { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const URL_OPTIONS = { allowInsecureUrls: false, allowedHosts: [] };
const NOW = new Date("2026-11-12T10:00:00.000Z");
const USER = "user-1";
const OTHER_USER = "user-2";

/** In-memory repository with the same contract as the D1 one (scoped by user). */
class FakeRepository implements IWebhookRepository {
  endpoints: WebhookEndpointRecord[] = [];
  deliveries: WebhookDeliveryRecord[] = [];
  lastFilter: ListDeliveriesFilter | null = null;
  private seq = 0;

  async findEndpointsByUser(userId: string) {
    return this.endpoints.filter((e) => e.userId === userId);
  }
  async findEndpoint(id: string, userId: string) {
    return this.endpoints.find((e) => e.id === id && e.userId === userId) ?? null;
  }
  async insertEndpoint(userId: string, values: { url: string; secret: string }) {
    const record: WebhookEndpointRecord = {
      id: `ep-${++this.seq}`,
      userId,
      url: values.url,
      secret: values.secret,
      previousSecret: null,
      previousSecretExpiresAt: null,
      enabled: true,
      disabledReason: null,
      consecutiveFailures: 0,
      createdAt: NOW,
      updatedAt: NOW,
    };
    this.endpoints.push(record);
    return record;
  }
  async updateEndpoint(id: string, userId: string, values: Partial<WebhookEndpointRecord>) {
    const record = await this.findEndpoint(id, userId);
    if (!record) return null;
    Object.assign(record, values);
    return { ...record };
  }
  async deleteEndpoint(id: string, userId: string) {
    const before = this.endpoints.length;
    this.endpoints = this.endpoints.filter((e) => !(e.id === id && e.userId === userId));
    return this.endpoints.length < before;
  }
  async listDeliveries(endpointId: string, filter: ListDeliveriesFilter) {
    this.lastFilter = filter;
    return this.deliveries.filter((d) => d.endpointId === endpointId).slice(0, filter.limit);
  }
  async findEndpointById(id: string) {
    return this.endpoints.find((e) => e.id === id) ?? null;
  }
  async findEnabledEndpointsByUser(userId: string) {
    return this.endpoints.filter((e) => e.userId === userId && e.enabled);
  }
  async insertEmailDeliveries() {}
  async findPendingDeliveriesForEmail() {
    return [];
  }
  async findDelivery(id: string) {
    return this.deliveries.find((d) => d.id === id) ?? null;
  }
  async insertTestDelivery(endpointId: string) {
    const delivery = makeDelivery(`test-${++this.seq}`, endpointId, NOW, { eventType: "webhook.test", emailId: null, status: "pending", attempts: 0 });
    this.deliveries.push(delivery);
    return delivery;
  }
  async updateDelivery(id: string, values: WebhookDeliveryUpdate) {
    Object.assign(this.deliveries.find((d) => d.id === id)!, values);
  }
  async findTestDeliveriesSince(endpointId: string, since: Date) {
    return this.deliveries.filter(
      (d) => d.endpointId === endpointId && d.eventType === "webhook.test" && d.createdAt >= since,
    );
  }
  async countAttemptsSince(endpointId: string, since: Date) {
    return this.deliveries.filter((d) => d.endpointId === endpointId && d.lastAttemptAt && d.lastAttemptAt >= since).length;
  }
  async resetFailedDelivery(id: string) {
    const delivery = this.deliveries.find((d) => d.id === id && d.status === "failed");
    if (!delivery) return null;
    Object.assign(delivery, { status: "pending", attempts: 0, lastError: null, lastStatusCode: null });
    return { ...delivery };
  }
  async resetEndpointFailures() {}
  async recordEndpointFailure() {
    return { consecutiveFailures: 1, disabled: false };
  }
  async failStalePendingDeliveries() {
    return 0;
  }
  async findEmailForWebhook() {
    return null;
  }
  async findEmailHistories() {
    return [];
  }
}

function makeDelivery(
  id: string,
  endpointId: string,
  createdAt: Date,
  overrides: Partial<WebhookDeliveryRecord> = {},
): WebhookDeliveryRecord {
  return {
    id,
    endpointId,
    emailId: `email-${id}`,
    eventType: "email.sent",
    failureKind: null,
    status: "delivered",
    attempts: 1,
    lastStatusCode: 200,
    lastError: null,
    lastAttemptAt: createdAt,
    deliveredAt: createdAt,
    createdAt,
    ...overrides,
  };
}

let repository: FakeRepository;
let service: WebhooksService;

beforeEach(() => {
  repository = new FakeRepository();
  service = new WebhooksService(repository, KEY, URL_OPTIONS, { now: () => NOW });
});

async function expectAppError(promise: Promise<unknown>, status: number, code?: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).statusCode).toBe(status);
  if (code) expect((error as AppError).code).toBe(code);
}

describe("create", () => {
  it("returns the normalized URL and a whsec_ secret, and stores both encrypted", async () => {
    const { endpoint, secret } = await service.create(USER, "https://App.Example.com/hook#x");

    expect(endpoint.url).toBe("https://app.example.com/hook");
    expect(secret).toMatch(/^whsec_/);
    expect(endpoint).not.toHaveProperty("secret");
    expect(endpoint).not.toHaveProperty("previousSecret");

    const stored = repository.endpoints[0];
    expect(stored.url).not.toContain("example.com");
    expect(stored.secret).not.toContain("whsec_");
    expect(await decrypt(stored.url, KEY)).toBe("https://app.example.com/hook");
    expect(await decrypt(stored.secret, KEY)).toBe(secret);
  });

  it("refuses a URL the rules reject with 400 WEBHOOK_URL_INVALID and the reason", async () => {
    const error = await service.create(USER, "http://app.example.com/hook").catch((e: AppError) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(400);
    expect((error as AppError).code).toBe("WEBHOOK_URL_INVALID");
    expect((error as AppError).message).toBe("Webhook URLs must use https.");
    await expectAppError(service.create(USER, "https://169.254.169.254/"), 400, "WEBHOOK_URL_INVALID");
    expect(repository.endpoints).toHaveLength(0);
  });

  it("allows 5 endpoints and refuses the 6th with 409 WEBHOOK_LIMIT_REACHED", async () => {
    for (let i = 0; i < 5; i++) await service.create(USER, `https://app.example.com/hook-${i}`);
    await expectAppError(service.create(USER, "https://app.example.com/hook-6"), 409, "WEBHOOK_LIMIT_REACHED");
    expect(repository.endpoints).toHaveLength(5);
  });

  it("refuses the same URL, even spelled differently, with 409 WEBHOOK_URL_EXISTS", async () => {
    await service.create(USER, "https://app.example.com/hook");
    await expectAppError(service.create(USER, "HTTPS://APP.example.com/hook#again"), 409, "WEBHOOK_URL_EXISTS");
  });

  it("does not count or compare another user's endpoints", async () => {
    for (let i = 0; i < 5; i++) await service.create(OTHER_USER, `https://app.example.com/hook-${i}`);
    await expect(service.create(USER, "https://app.example.com/hook-0")).resolves.toBeDefined();
  });
});

describe("list and get", () => {
  it("lists the user's endpoints with decrypted URLs and no secret", async () => {
    await service.create(USER, "https://a.example.com/");
    await service.create(OTHER_USER, "https://b.example.com/");

    const endpoints = await service.list(USER);
    expect(endpoints.map((e) => e.url)).toEqual(["https://a.example.com/"]);
    expect(endpoints[0]).not.toHaveProperty("secret");
  });

  it("answers the same 404 for an unknown id and for another user's endpoint", async () => {
    const { endpoint } = await service.create(OTHER_USER, "https://b.example.com/");
    await expectAppError(service.get("missing", USER), 404, "WEBHOOK_NOT_FOUND");
    await expectAppError(service.get(endpoint.id, USER), 404, "WEBHOOK_NOT_FOUND");
  });
});

describe("update", () => {
  it("changes the URL without changing the secret", async () => {
    const { endpoint, secret } = await service.create(USER, "https://a.example.com/");
    const updated = await service.update(endpoint.id, USER, { url: "https://b.example.com/" });

    expect(updated.url).toBe("https://b.example.com/");
    expect(await decrypt(repository.endpoints[0].secret, KEY)).toBe(secret);
  });

  it("refuses a URL used by another endpoint of the user, but not its own", async () => {
    const { endpoint: a } = await service.create(USER, "https://a.example.com/");
    await service.create(USER, "https://b.example.com/");

    await expectAppError(service.update(a.id, USER, { url: "https://b.example.com/" }), 409, "WEBHOOK_URL_EXISTS");
    await expect(service.update(a.id, USER, { url: "https://A.example.com/" })).resolves.toMatchObject({
      url: "https://a.example.com/",
    });
  });

  it("enabled: false marks the endpoint disabled by hand", async () => {
    const { endpoint } = await service.create(USER, "https://a.example.com/");
    const updated = await service.update(endpoint.id, USER, { enabled: false });
    expect(updated).toMatchObject({ enabled: false, disabledReason: "manual" });
  });

  it("enabled: true after an automatic disable clears the reason and the failure count", async () => {
    const { endpoint } = await service.create(USER, "https://a.example.com/");
    Object.assign(repository.endpoints[0], { enabled: false, disabledReason: "auto", consecutiveFailures: 20 });

    const updated = await service.update(endpoint.id, USER, { enabled: true });
    expect(updated).toMatchObject({ enabled: true, disabledReason: null, consecutiveFailures: 0 });
  });

  it("applies the URL rules and the 404 rule", async () => {
    const { endpoint } = await service.create(USER, "https://a.example.com/");
    await expectAppError(service.update(endpoint.id, USER, { url: "https://10.0.0.1/" }), 400, "WEBHOOK_URL_INVALID");
    await expectAppError(service.update(endpoint.id, OTHER_USER, { enabled: false }), 404, "WEBHOOK_NOT_FOUND");
  });
});

describe("delete", () => {
  it("deletes the user's endpoint and answers 404 the second time or for someone else's", async () => {
    const { endpoint } = await service.create(USER, "https://a.example.com/");
    await expectAppError(service.delete(endpoint.id, OTHER_USER), 404, "WEBHOOK_NOT_FOUND");
    await service.delete(endpoint.id, USER);
    expect(repository.endpoints).toHaveLength(0);
    await expectAppError(service.delete(endpoint.id, USER), 404, "WEBHOOK_NOT_FOUND");
  });
});

describe("rotateSecret", () => {
  it("returns a new secret and keeps the old one signing for 24 h", async () => {
    const { endpoint, secret: first } = await service.create(USER, "https://a.example.com/");
    const encryptedFirst = repository.endpoints[0].secret;

    const { endpoint: rotated, secret: second } = await service.rotateSecret(endpoint.id, USER);

    expect(second).toMatch(/^whsec_/);
    expect(second).not.toBe(first);
    const stored = repository.endpoints[0];
    expect(await decrypt(stored.secret, KEY)).toBe(second);
    expect(stored.previousSecret).toBe(encryptedFirst);
    expect(stored.previousSecretExpiresAt).toEqual(new Date("2026-11-13T10:00:00.000Z"));
    expect(rotated).not.toHaveProperty("secret");
    expect(rotated.url).toBe("https://a.example.com/");
  });

  it("expireCurrentNow drops the old secret at once", async () => {
    const { endpoint } = await service.create(USER, "https://a.example.com/");
    await service.rotateSecret(endpoint.id, USER, { expireCurrentNow: true });
    expect(repository.endpoints[0]).toMatchObject({ previousSecret: null, previousSecretExpiresAt: null });
  });

  it("a second rotation replaces the previous secret: only the last two stay valid", async () => {
    const { endpoint } = await service.create(USER, "https://a.example.com/");
    const { secret: second } = await service.rotateSecret(endpoint.id, USER);
    await service.rotateSecret(endpoint.id, USER);
    expect(await decrypt(repository.endpoints[0].previousSecret!, KEY)).toBe(second);
  });

  it("answers 404 for another user's endpoint", async () => {
    const { endpoint } = await service.create(OTHER_USER, "https://a.example.com/");
    await expectAppError(service.rotateSecret(endpoint.id, USER), 404, "WEBHOOK_NOT_FOUND");
  });
});

describe("listDeliveries", () => {
  const delivery = (id: string, createdAt: Date) => makeDelivery(id, "ep-1", createdAt);

  it("checks ownership before reading the log", async () => {
    const { endpoint } = await service.create(OTHER_USER, "https://a.example.com/");
    await expectAppError(service.listDeliveries(endpoint.id, USER, { limit: 20 }), 404, "WEBHOOK_NOT_FOUND");
    expect(repository.lastFilter).toBeNull();
  });

  it("asks one extra row and returns a cursor only when there is a next page", async () => {
    await service.create(USER, "https://a.example.com/");
    repository.deliveries = [
      delivery("d3", new Date(3000)),
      delivery("d2", new Date(2000)),
      delivery("d1", new Date(1000)),
    ];

    const page = await service.listDeliveries("ep-1", USER, { limit: 2, status: "delivered" });
    expect(repository.lastFilter).toEqual({ status: "delivered", limit: 3, after: undefined });
    expect(page.deliveries.map((d) => d.id)).toEqual(["d3", "d2"]);
    expect(decodeDeliveryCursor(page.nextCursor!)).toEqual({ createdAt: new Date(2000), id: "d2" });

    const last = await service.listDeliveries("ep-1", USER, { limit: 5 });
    expect(last.nextCursor).toBeNull();
  });

  it("passes the decoded cursor and refuses a forged one with 400", async () => {
    await service.create(USER, "https://a.example.com/");
    const cursor = encodeDeliveryCursor({ createdAt: new Date(2000), id: "d2" });
    await service.listDeliveries("ep-1", USER, { limit: 20, cursor });
    expect(repository.lastFilter?.after).toEqual({ createdAt: new Date(2000), id: "d2" });

    await expectAppError(service.listDeliveries("ep-1", USER, { limit: 20, cursor: "%%%" }), 400);
    await expectAppError(
      service.listDeliveries("ep-1", USER, { limit: 20, cursor: btoa("1' OR 1=1|x") }),
      400,
    );
  });
});

describe("encryption key", () => {
  it("decrypts URLs written under the key the service was given", async () => {
    repository.endpoints.push({
      id: "ep-x",
      userId: USER,
      url: await encrypt("https://a.example.com/", KEY),
      secret: await encrypt("whsec_x", KEY),
      previousSecret: null,
      previousSecretExpiresAt: null,
      enabled: true,
      disabledReason: null,
      consecutiveFailures: 0,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect((await service.get("ep-x", USER)).url).toBe("https://a.example.com/");
  });
});

describe("sendTest", () => {
  type FetchCall = { url: string; init: RequestInit };
  let calls: FetchCall[];

  const withFetch = (respond: () => Response | Promise<Response>, now: () => Date = () => NOW) => {
    calls = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return respond();
    }) as unknown as typeof fetch;
    return new WebhooksService(repository, KEY, URL_OPTIONS, { now, fetch: fetchMock });
  };

  it("POSTs a webhook.test signed like a real event, and logs it delivered", async () => {
    const { endpoint, secret } = await service.create(USER, "https://a.example.com/hook");
    // The real clock: standardwebhooks refuses timestamps more than 5 minutes away.
    const result = await withFetch(() => new Response("ok", { status: 200 }), () => new Date()).sendTest(endpoint.id, USER);

    expect(result).toEqual({ ok: true, statusCode: 200, error: null, durationMs: expect.any(Number) });
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    const headers = init.headers as Record<string, string>;
    const body = init.body as string;
    expect(url).toBe("https://a.example.com/hook");
    expect(init.redirect).toBe("manual");
    expect(headers["User-Agent"]).toMatch(/^MakiSend-Webhooks\//);

    const event = new Webhook(secret).verify(body, headers);
    expect(event).toEqual({
      type: "webhook.test",
      timestamp: expect.any(String),
      data: { endpointId: endpoint.id, message: "Test event from MakiSend" },
    });

    const logged = repository.deliveries.find((d) => d.eventType === "webhook.test")!;
    expect(headers["webhook-id"]).toBe(`msg_${logged.id}`);
    expect(logged).toMatchObject({ status: "delivered", attempts: 1, lastStatusCode: 200, emailId: null });
  });

  it("reports a receiver failure in the result, never its response body", async () => {
    const { endpoint } = await service.create(USER, "https://a.example.com/hook");
    const result = await withFetch(() => new Response("<html>internal secrets</html>", { status: 500 })).sendTest(
      endpoint.id,
      USER,
    );
    expect(result).toEqual({ ok: false, statusCode: 500, error: "HTTP 500", durationMs: expect.any(Number) });
    expect(JSON.stringify(result)).not.toContain("secrets");
    expect(repository.deliveries.at(-1)).toMatchObject({ status: "failed", lastError: "HTTP 500" });
  });

  it("works on a disabled endpoint", async () => {
    const { endpoint } = await service.create(USER, "https://a.example.com/hook");
    await service.update(endpoint.id, USER, { enabled: false });
    const result = await withFetch(() => new Response(null, { status: 204 })).sendTest(endpoint.id, USER);
    expect(result.ok).toBe(true);
  });

  it("allows 5 tests per minute, then answers 429 with the seconds to wait", async () => {
    const { endpoint } = await service.create(USER, "https://a.example.com/hook");
    const svc = withFetch(() => new Response(null, { status: 200 }));
    for (let i = 0; i < 5; i++) await svc.sendTest(endpoint.id, USER);

    const error = await svc.sendTest(endpoint.id, USER).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WebhookRateLimitedError);
    expect((error as WebhookRateLimitedError).statusCode).toBe(429);
    expect((error as WebhookRateLimitedError).code).toBe("WEBHOOK_TEST_RATE_LIMITED");
    expect((error as WebhookRateLimitedError).retryAfterSeconds).toBe(60);
    expect(calls).toHaveLength(5);
  });

  it("refuses an endpoint whose stored URL no longer passes the rules, without calling it", async () => {
    const { endpoint } = await service.create(USER, "https://a.example.com/hook");
    repository.endpoints[0].url = await encrypt("https://10.0.0.1/hook", KEY);
    const svc = withFetch(() => new Response(null, { status: 200 }));
    await expectAppError(svc.sendTest(endpoint.id, USER), 400, "WEBHOOK_URL_INVALID");
    expect(calls).toHaveLength(0);
  });

  it("answers 404 for another user's endpoint", async () => {
    const { endpoint } = await service.create(OTHER_USER, "https://a.example.com/hook");
    await expectAppError(withFetch(() => new Response()).sendTest(endpoint.id, USER), 404, "WEBHOOK_NOT_FOUND");
  });
});

describe("retryDelivery", () => {
  const send = vi.fn();
  const withQueue = () =>
    new WebhooksService(repository, KEY, URL_OPTIONS, {
      now: () => NOW,
      queue: { send } as unknown as Queue<{ deliveryId: string }>,
    });

  beforeEach(() => {
    send.mockResolvedValue(undefined);
  });

  it("puts a failed delivery back to pending and in the queue", async () => {
    const { endpoint } = await service.create(USER, "https://a.example.com/");
    repository.deliveries.push(makeDelivery("d1", endpoint.id, new Date(0), { status: "failed", attempts: 8, lastAttemptAt: new Date(0) }));

    const delivery = await withQueue().retryDelivery(endpoint.id, "d1", USER);
    expect(delivery).toMatchObject({ id: "d1", status: "pending", attempts: 0 });
    expect(send).toHaveBeenCalledExactlyOnceWith({ deliveryId: "d1" });
  });

  it("answers 409 for a delivery that is not failed, 404 for another endpoint's", async () => {
    const { endpoint } = await service.create(USER, "https://a.example.com/");
    const { endpoint: other } = await service.create(USER, "https://b.example.com/");
    repository.deliveries.push(makeDelivery("ok", endpoint.id, new Date(0), { lastAttemptAt: new Date(0) }));
    repository.deliveries.push(makeDelivery("theirs", other.id, new Date(0), { status: "failed" }));

    await expectAppError(withQueue().retryDelivery(endpoint.id, "ok", USER), 409, "WEBHOOK_DELIVERY_NOT_FAILED");
    await expectAppError(withQueue().retryDelivery(endpoint.id, "theirs", USER), 404, "WEBHOOK_DELIVERY_NOT_FOUND");
    await expectAppError(withQueue().retryDelivery(endpoint.id, "missing", USER), 404, "WEBHOOK_DELIVERY_NOT_FOUND");
    expect(send).not.toHaveBeenCalled();
  });

  it("puts the delivery back to failed when the queue refuses it", async () => {
    const { endpoint } = await service.create(USER, "https://a.example.com/");
    repository.deliveries.push(makeDelivery("d1", endpoint.id, new Date(0), { status: "failed", lastAttemptAt: new Date(0) }));
    send.mockRejectedValue(new Error("queue down"));

    await expect(withQueue().retryDelivery(endpoint.id, "d1", USER)).rejects.toThrow("queue down");
    expect(repository.deliveries[0].status).toBe("failed");
  });
});
