/**
 * B1 (publication) and B2 (delivery) on a real D1: WebhookPublisher → queue → webhookQueueConsumer
 * → signed POST. The queue and the receiver are fakes; everything else is the production code.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Miniflare } from "miniflare";
import { drizzle } from "drizzle-orm/d1";
import { Webhook } from "standardwebhooks";
import { encrypt } from "@/core/crypto";
import type { Bindings } from "@/index";
import { isWebhookBatch, webhookQueueConsumer } from "@/queue/webhook.consumer";
import { WebhookPublisher } from "@/webhooks/webhook-publisher";
import { retryDelaySeconds } from "@/webhooks/webhook-processor";
import { runWebhookSweep } from "@/webhooks/webhook-maintenance";
import { WebhookRepository } from "@/webhooks/webhooks.repository";
import { generateSecret } from "@/webhooks/webhook-signature";
import { WEBHOOK_MAX_ATTEMPTS } from "@/webhooks/webhooks.constants";
import type { WebhookQueueMessage } from "@/webhooks/webhooks.types";
import { cleanupTestD1, createTestD1 } from "../../helpers/d1-setup";

const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const RAW_NODEMAILER = "Connection timeout to smtp.internal.acme.lan (10.1.2.3:587): ETIMEDOUT";

let mf: Miniflare;
let d1: D1Database;
let env: Bindings;
let repository: WebhookRepository;
let secret: string;

type Sent = { url: string; headers: Record<string, string>; body: string };
let sent: Sent[];
let respond: () => Response | Promise<Response>;
const fakeFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
  sent.push({ url: String(url), headers: init!.headers as Record<string, string>, body: init!.body as string });
  return respond();
}) as unknown as typeof fetch;

const queued: WebhookQueueMessage[] = [];
const fakeQueue = {
  sendBatch: vi.fn(async (messages: { body: WebhookQueueMessage }[]) => {
    queued.push(...messages.map((m) => m.body));
  }),
  send: vi.fn(async (body: WebhookQueueMessage) => {
    queued.push(body);
  }),
} as unknown as Queue<WebhookQueueMessage>;

function message(deliveryId: unknown, attempts = 1) {
  return { body: { deliveryId }, attempts, ack: vi.fn(), retry: vi.fn() };
}

async function consume(...messages: ReturnType<typeof message>[]) {
  await webhookQueueConsumer({ queue: "makisend-webhooks", messages } as never, env, { fetch: fakeFetch });
}

async function seedEndpoint(id: string, url: string, options: { userId?: string; enabled?: boolean } = {}) {
  await d1
    .prepare(`INSERT INTO "webhook_endpoints" (id, user_id, url, secret, enabled) VALUES (?1, ?2, ?3, ?4, ?5)`)
    .bind(id, options.userId ?? "u1", await encrypt(url, KEY), await encrypt(secret, KEY), options.enabled === false ? 0 : 1)
    .run();
}

async function seedEmail(id: string, options: { source?: "api" | "test"; userId?: string; final?: "sent" | "failed" } = {}) {
  await d1
    .prepare(
      `INSERT INTO "email_logs" ("internalId", user_id, "to", subject, smtp_id, source, created_at)
       VALUES (?1, ?2, ?3, 'Votre facture', ?4, ?5, '2026-11-11T10:45:48.534Z')`,
    )
    .bind(id, options.userId ?? "u1", await encrypt("client@example.com", KEY), "<m1@smtp>", options.source ?? "api")
    .run();
  const insert = d1.prepare(`INSERT INTO "email_histories" (id, email_id, status, error, attempts, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`);
  await d1.batch([
    insert.bind(`${id}-h1`, id, "received", null, null, "2026-11-11T10:45:48.600Z"),
    insert.bind(`${id}-h2`, id, "attempt_failed", RAW_NODEMAILER, 1, "2026-11-11T10:45:50.000Z"),
    options.final === "failed"
      ? insert.bind(`${id}-h3`, id, "failed", "Delivery abandoned after 4 attempts: The SMTP server did not respond in time.", 4, "2026-11-11T10:47:39.900Z")
      : insert.bind(`${id}-h3`, id, "sent", null, 2, "2026-11-11T10:46:21.198Z"),
  ]);
}

const row = (id: string) =>
  d1.prepare(`SELECT * FROM "webhook_deliveries" WHERE id = ?1`).bind(id).first<Record<string, unknown>>();
const endpointRow = (id: string) =>
  d1.prepare(`SELECT * FROM "webhook_endpoints" WHERE id = ?1`).bind(id).first<Record<string, unknown>>();
const allDeliveries = () =>
  d1.prepare(`SELECT * FROM "webhook_deliveries" ORDER BY endpoint_id`).all<Record<string, unknown>>().then((r) => r.results);

beforeAll(async () => {
  ({ mf, d1 } = await createTestD1());
  env = { AES_256_KEY: KEY, makisend_db: d1 } as unknown as Bindings;
  repository = new WebhookRepository(drizzle(d1));
});

afterAll(async () => {
  await cleanupTestD1(mf);
});

beforeEach(async () => {
  sent = [];
  queued.length = 0;
  respond = () => new Response(null, { status: 200 });
  secret = generateSecret();
  await d1.batch([
    d1.prepare(`DELETE FROM "webhook_deliveries"`),
    d1.prepare(`DELETE FROM "webhook_endpoints"`),
    d1.prepare(`DELETE FROM "email_histories"`),
    d1.prepare(`DELETE FROM "email_logs"`),
    d1.prepare(`DELETE FROM "user"`),
    d1.prepare(
      `INSERT INTO "user" (id, email, email_verified, created_at, updated_at) VALUES ('u1', 'a@b.c', 1, 0, 0), ('u2', 'd@e.f', 1, 0, 0)`,
    ),
  ]);
});

describe("WebhookPublisher.publishFinalStatus (B1)", () => {
  const publisher = () => new WebhookPublisher(repository, fakeQueue);

  it("does nothing, and costs one read, when the user has no endpoint", async () => {
    await seedEmail("e1");
    expect(await publisher().publishFinalStatus("e1", "sent")).toBe(0);
    expect(await publisher().hasEnabledEndpoints("e1")).toBe(false);
    expect(await allDeliveries()).toEqual([]);
    expect(fakeQueue.sendBatch).not.toHaveBeenCalled();
  });

  it("never publishes for a dashboard test send, nor for an unknown email", async () => {
    await seedEndpoint("w1", "https://a.example.com/");
    await seedEmail("e1", { source: "test" });
    expect(await publisher().publishFinalStatus("e1", "sent")).toBe(0);
    expect(await publisher().publishFinalStatus("nope", "sent")).toBe(0);
    expect(await publisher().hasEnabledEndpoints("e1")).toBe(false);
    expect(await allDeliveries()).toEqual([]);
  });

  it("writes one pending promise per ENABLED endpoint of the owner, then queues their ids", async () => {
    await seedEndpoint("w1", "https://a.example.com/");
    await seedEndpoint("w2", "https://b.example.com/");
    await seedEndpoint("w3", "https://c.example.com/", { enabled: false });
    await seedEndpoint("w4", "https://d.example.com/", { userId: "u2" });
    await seedEmail("e1");

    expect(await publisher().hasEnabledEndpoints("e1")).toBe(true);
    expect(await publisher().publishFinalStatus("e1", "sent")).toBe(2);

    const rows = await allDeliveries();
    expect(rows.map((r) => [r.endpoint_id, r.email_id, r.event_type, r.status, r.failure_kind])).toEqual([
      ["w1", "e1", "email.sent", "pending", null],
      ["w2", "e1", "email.sent", "pending", null],
    ]);
    expect(queued.map((m) => m.deliveryId).sort()).toEqual(rows.map((r) => r.id).sort());
  });

  it("replaying the publication creates no second delivery and re-sends the pending ids", async () => {
    await seedEndpoint("w1", "https://a.example.com/");
    await seedEmail("e1", { final: "failed" });

    await publisher().publishFinalStatus("e1", "failed", "transient_exhausted");
    const first = queued.map((m) => m.deliveryId);
    await publisher().publishFinalStatus("e1", "failed", "transient_exhausted");

    const rows = await allDeliveries();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ event_type: "email.failed", failure_kind: "transient_exhausted" });
    expect(queued.map((m) => m.deliveryId)).toEqual([...first, ...first]);
  });

  it("a replay after the delivery is done queues nothing", async () => {
    await seedEndpoint("w1", "https://a.example.com/");
    await seedEmail("e1");
    await publisher().publishFinalStatus("e1", "sent");
    await d1.prepare(`UPDATE "webhook_deliveries" SET status = 'delivered'`).run();

    queued.length = 0;
    expect(await publisher().publishFinalStatus("e1", "sent")).toBe(0);
    expect(queued).toEqual([]);
  });

  it("without the queue binding, the promises are still written (outbox), then it throws", async () => {
    await seedEndpoint("w1", "https://a.example.com/");
    await seedEmail("e1");
    await expect(new WebhookPublisher(repository, undefined).publishFinalStatus("e1", "sent")).rejects.toThrow(/WEBHOOK_QUEUE/);
    expect(await allDeliveries()).toHaveLength(1);
  });
});

describe("webhookQueueConsumer (B2)", () => {
  async function publishOne(emailOptions: Parameters<typeof seedEmail>[1] = {}) {
    await seedEndpoint("w1", "https://hooks.example.com/in?token=abc");
    await seedEmail("e1", emailOptions);
    await new WebhookPublisher(repository, fakeQueue).publishFinalStatus(
      "e1",
      emailOptions.final ?? "sent",
      emailOptions.final === "failed" ? "transient_exhausted" : null,
    );
    return queued[0].deliveryId;
  }

  it("delivers a signed email.sent the official library verifies, then writes the row and acks", async () => {
    const id = await publishOne();
    const msg = message(id);
    await consume(msg);

    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("https://hooks.example.com/in?token=abc");
    const event = new Webhook(secret).verify(sent[0].body, sent[0].headers) as { type: string; data: Record<string, unknown> };
    expect(sent[0].headers["webhook-id"]).toBe(`msg_${id}`);
    expect(event.type).toBe("email.sent");
    expect(event.data).toMatchObject({ emailId: "e1", status: "sent", to: "client@example.com", smtpMessageId: "<m1@smtp>", attempts: 2 });
    expect(sent[0].body).not.toContain("10.1.2.3");

    expect(await row(id)).toMatchObject({ status: "delivered", attempts: 1, last_status_code: 200, last_error: null });
    expect((await row(id))!.delivered_at).not.toBeNull();
    expect(msg.ack).toHaveBeenCalledOnce();
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it("delivers email.failed with failureKind and the filtered reason", async () => {
    const id = await publishOne({ final: "failed" });
    await consume(message(id));
    const event = JSON.parse(sent[0].body) as { type: string; data: Record<string, unknown> };
    expect(event.type).toBe("email.failed");
    expect(event.data).toMatchObject({ failureKind: "transient_exhausted", status: "failed", smtpMessageId: null });
  });

  it("a duplicate message of a delivered row is acked without a second POST", async () => {
    const id = await publishOne();
    await consume(message(id));
    const duplicate = message(id);
    await consume(duplicate);
    expect(sent).toHaveLength(1);
    expect(duplicate.ack).toHaveBeenCalledOnce();
  });

  it("acks without sending when the delivery is gone (endpoint deleted), or the message is malformed", async () => {
    const gone = message("no-such-delivery");
    const malformed = message(undefined);
    await consume(gone, malformed);
    expect(sent).toEqual([]);
    expect(gone.ack).toHaveBeenCalledOnce();
    expect(malformed.ack).toHaveBeenCalledOnce();
  });

  it("marks the delivery skipped when the endpoint was disabled meanwhile", async () => {
    const id = await publishOne();
    await d1.prepare(`UPDATE "webhook_endpoints" SET enabled = 0, disabled_reason = 'manual'`).run();
    const msg = message(id);
    await consume(msg);
    expect(sent).toEqual([]);
    expect(await row(id)).toMatchObject({ status: "skipped" });
    expect(msg.ack).toHaveBeenCalledOnce();
  });

  it("marks the delivery skipped when the email was deleted", async () => {
    const id = await publishOne();
    await d1.prepare(`DELETE FROM "email_logs"`).run();
    await consume(message(id));
    expect(sent).toEqual([]);
    expect(await row(id)).toMatchObject({ status: "skipped" });
  });

  it("revalidates the URL before sending: a stored URL the rules now refuse fails without a call", async () => {
    const id = await publishOne();
    await d1.prepare(`UPDATE "webhook_endpoints" SET url = ?1`).bind(await encrypt("https://169.254.169.254/", KEY)).run();
    await consume(message(id));
    expect(sent).toEqual([]);
    expect(await row(id)).toMatchObject({ status: "failed", last_error: "url refused" });
  });

  it("a 500 keeps the row pending, counts the attempt and retries after the scheduled delay", async () => {
    const id = await publishOne();
    respond = () => new Response("boom", { status: 500 });
    const msg = message(id);
    await consume(msg);

    expect(await row(id)).toMatchObject({ status: "pending", attempts: 1, last_status_code: 500, last_error: "HTTP 500" });
    expect(msg.retry).toHaveBeenCalledExactlyOnceWith({ delaySeconds: 60 });
    expect(msg.ack).not.toHaveBeenCalled();
  });

  it("a 429 retries after its Retry-After", async () => {
    const id = await publishOne();
    respond = () => new Response(null, { status: 429, headers: { "Retry-After": "120" } });
    const msg = message(id);
    await consume(msg);
    expect(msg.retry).toHaveBeenCalledExactlyOnceWith({ delaySeconds: 120 });
  });

  it("a 404 is abandoned at once and counted against the endpoint", async () => {
    const id = await publishOne();
    respond = () => new Response(null, { status: 404 });
    const msg = message(id);
    await consume(msg);
    expect(await row(id)).toMatchObject({ status: "failed", attempts: 1, last_status_code: 404 });
    expect(await endpointRow("w1")).toMatchObject({ consecutive_failures: 1, enabled: 1 });
    expect(msg.ack).toHaveBeenCalledOnce();
  });

  it("the 8th failed attempt abandons the delivery instead of retrying", async () => {
    const id = await publishOne();
    await d1.prepare(`UPDATE "webhook_deliveries" SET attempts = ?1`).bind(WEBHOOK_MAX_ATTEMPTS - 1).run();
    respond = () => new Response(null, { status: 503 });
    const msg = message(id, WEBHOOK_MAX_ATTEMPTS);
    await consume(msg);
    expect(await row(id)).toMatchObject({ status: "failed", attempts: WEBHOOK_MAX_ATTEMPTS });
    expect(msg.retry).not.toHaveBeenCalled();
    expect(msg.ack).toHaveBeenCalledOnce();
  });

  it("never retries past the queue's own budget, even when the row counted fewer attempts", async () => {
    const id = await publishOne();
    respond = () => new Response(null, { status: 503 });
    const msg = message(id, WEBHOOK_MAX_ATTEMPTS);
    await consume(msg);
    expect(msg.retry).not.toHaveBeenCalled();
    expect(await row(id)).toMatchObject({ status: "failed" });
  });

  it("disables the endpoint at the 20th consecutive abandoned delivery", async () => {
    const id = await publishOne();
    await d1.prepare(`UPDATE "webhook_endpoints" SET consecutive_failures = 19`).run();
    respond = () => new Response(null, { status: 410 });
    await consume(message(id));
    expect(await endpointRow("w1")).toMatchObject({ consecutive_failures: 20, enabled: 0, disabled_reason: "auto" });
  });

  it("a success resets the failure streak", async () => {
    const id = await publishOne();
    await d1.prepare(`UPDATE "webhook_endpoints" SET consecutive_failures = 7`).run();
    await consume(message(id));
    expect(await endpointRow("w1")).toMatchObject({ consecutive_failures: 0 });
  });

  it("an unexpected error retries the message (queue retry_delay) without acking it", async () => {
    const id = await publishOne();
    const msg = message(id);
    const broken = {
      ...repository,
      findDelivery: vi.fn(async () => {
        throw new Error("D1 unavailable");
      }),
    } as unknown as WebhookRepository;
    await webhookQueueConsumer({ queue: "makisend-webhooks", messages: [msg] } as never, env, {
      fetch: fakeFetch,
      repository: broken,
    });
    expect(msg.retry).toHaveBeenCalledExactlyOnceWith();
    expect(msg.ack).not.toHaveBeenCalled();
  });

  it("handles each message of a batch on its own", async () => {
    await seedEndpoint("w1", "https://ok.example.com/");
    await seedEndpoint("w2", "https://down.example.com/");
    await seedEmail("e1");
    await new WebhookPublisher(repository, fakeQueue).publishFinalStatus("e1", "sent");
    respond = () => new Response(null, { status: sent.at(-1)!.url.includes("down") ? 503 : 200 });

    const messages = queued.map((m) => message(m.deliveryId));
    await consume(...messages);

    const acked = messages.filter((m) => m.ack.mock.calls.length === 1).length;
    const retried = messages.filter((m) => m.retry.mock.calls.length === 1).length;
    expect([acked, retried]).toEqual([1, 1]);
  });
});

describe("queue routing and schedule", () => {
  it("recognizes a webhooks batch by name or by body, whatever the queue was renamed to", () => {
    expect(isWebhookBatch({ queue: "makisend-webhooks-preview", messages: [] } as never)).toBe(true);
    expect(isWebhookBatch({ queue: "my-hooks", messages: [{ body: { deliveryId: "d1" } }] } as never)).toBe(true);
    expect(isWebhookBatch({ queue: "makisend-send-email", messages: [{ body: { emailId: "e1" } }] } as never)).toBe(false);
  });

  it("follows 1 min, 5 min, 30 min, 2 h, 6 h, 12 h, 12 h; Retry-After wins, capped at 12 h", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => retryDelaySeconds(n, null))).toEqual([60, 300, 1800, 7200, 21600, 43200, 43200]);
    expect(retryDelaySeconds(1, 5)).toBe(5);
    expect(retryDelaySeconds(1, 999_999)).toBe(43_200);
  });
});

describe("runWebhookSweep (daily cron)", () => {
  it("fails the deliveries pending for more than 48 h, and only those", async () => {
    await seedEndpoint("w1", "https://a.example.com/");
    const now = new Date("2026-11-12T10:00:00.000Z");
    const insert = d1.prepare(`INSERT INTO "webhook_deliveries" (id, endpoint_id, email_id, event_type, status, created_at) VALUES (?1, 'w1', ?2, 'email.sent', ?3, ?4)`);
    await d1.batch([
      insert.bind("old", "e1", "pending", now.getTime() - 49 * 3600_000),
      insert.bind("recent", "e2", "pending", now.getTime() - 47 * 3600_000),
      insert.bind("done", "e3", "delivered", now.getTime() - 72 * 3600_000),
    ]);

    expect(await runWebhookSweep(env, now)).toBe(1);
    expect(await row("old")).toMatchObject({ status: "failed" });
    expect(await row("recent")).toMatchObject({ status: "pending" });
    expect(await row("done")).toMatchObject({ status: "delivered" });
  });
});
