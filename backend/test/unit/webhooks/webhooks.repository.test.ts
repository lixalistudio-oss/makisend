import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Miniflare } from "miniflare";
import { drizzle } from "drizzle-orm/d1";
import { decrypt, encrypt, keyId } from "@/core/crypto";
import { ENCRYPTED_COLUMNS, KeyRotationRepository, KeyRotationService } from "@/key-rotation";
import { WebhookRepository } from "@/webhooks/webhooks.repository";
import { cleanupTestD1, createTestD1 } from "../../helpers/d1-setup";

describe("WebhookRepository (real D1)", () => {
  let mf: Miniflare;
  let d1: D1Database;
  let repository: WebhookRepository;

  beforeAll(async () => {
    ({ mf, d1 } = await createTestD1());
    repository = new WebhookRepository(drizzle(d1));
  });

  afterAll(async () => {
    await cleanupTestD1(mf);
  });

  beforeEach(async () => {
    await d1.batch([
      d1.prepare(`DELETE FROM "webhook_deliveries"`),
      d1.prepare(`DELETE FROM "webhook_endpoints"`),
      d1.prepare(`DELETE FROM "user"`),
      d1.prepare(
        `INSERT INTO "user" (id, email, email_verified, created_at, updated_at) VALUES ('u1', 'a@b.c', 1, 0, 0), ('u2', 'd@e.f', 1, 0, 0)`,
      ),
    ]);
  });

  const insertDelivery = (id: string, endpointId: string, emailId: string | null, createdAt: number, status = "delivered") =>
    d1
      .prepare(
        `INSERT INTO "webhook_deliveries" (id, endpoint_id, email_id, event_type, status, created_at)
         VALUES (?1, ?2, ?3, 'email.sent', ?4, ?5)`,
      )
      .bind(id, endpointId, emailId, status, createdAt)
      .run();

  it("inserts an endpoint with the column defaults", async () => {
    const created = await repository.insertEndpoint("u1", { url: "enc-url", secret: "enc-secret" });

    expect(created).toMatchObject({
      userId: "u1",
      url: "enc-url",
      secret: "enc-secret",
      previousSecret: null,
      previousSecretExpiresAt: null,
      enabled: true,
      disabledReason: null,
      consecutiveFailures: 0,
    });
    expect(created.id).toEqual(expect.any(String));
    expect(created.createdAt).toBeInstanceOf(Date);
  });

  it("scopes every read and write by user: someone else's endpoint does not exist", async () => {
    const mine = await repository.insertEndpoint("u1", { url: "a", secret: "s" });

    expect(await repository.findEndpoint(mine.id, "u2")).toBeNull();
    expect(await repository.updateEndpoint(mine.id, "u2", { enabled: false })).toBeNull();
    expect(await repository.deleteEndpoint(mine.id, "u2")).toBe(false);
    expect(await repository.findEndpointsByUser("u2")).toEqual([]);

    expect((await repository.findEndpoint(mine.id, "u1"))?.enabled).toBe(true);
  });

  it("lists a user's endpoints oldest first", async () => {
    const first = await repository.insertEndpoint("u1", { url: "a", secret: "s" });
    await d1.prepare(`UPDATE "webhook_endpoints" SET created_at = 1000 WHERE id = ?1`).bind(first.id).run();
    const second = await repository.insertEndpoint("u1", { url: "b", secret: "s" });

    expect((await repository.findEndpointsByUser("u1")).map((e) => e.id)).toEqual([first.id, second.id]);
  });

  it("updates the given fields, clears the nullable ones and bumps updated_at", async () => {
    const created = await repository.insertEndpoint("u1", { url: "a", secret: "s" });
    await d1.prepare(`UPDATE "webhook_endpoints" SET updated_at = 1000 WHERE id = ?1`).bind(created.id).run();
    const expires = new Date("2026-11-13T10:00:00.000Z");

    const rotated = await repository.updateEndpoint(created.id, "u1", {
      secret: "s2",
      previousSecret: "s",
      previousSecretExpiresAt: expires,
    });
    expect(rotated).toMatchObject({ secret: "s2", previousSecret: "s", previousSecretExpiresAt: expires, url: "a" });
    expect(rotated!.updatedAt.getTime()).toBeGreaterThan(1000);

    const cleared = await repository.updateEndpoint(created.id, "u1", { previousSecret: null, previousSecretExpiresAt: null });
    expect(cleared).toMatchObject({ previousSecret: null, previousSecretExpiresAt: null });
  });

  it("deleting an endpoint deletes its deliveries (cascade)", async () => {
    const endpoint = await repository.insertEndpoint("u1", { url: "a", secret: "s" });
    await insertDelivery("d1", endpoint.id, "e1", 1000);

    expect(await repository.deleteEndpoint(endpoint.id, "u1")).toBe(true);
    const left = await d1.prepare(`SELECT COUNT(*) AS n FROM "webhook_deliveries"`).first<{ n: number }>();
    expect(left?.n).toBe(0);
  });

  it("deleting the user deletes their endpoints (cascade)", async () => {
    await repository.insertEndpoint("u1", { url: "a", secret: "s" });
    await d1.prepare(`DELETE FROM "user" WHERE id = 'u1'`).run();
    expect(await repository.findEndpointsByUser("u1")).toEqual([]);
  });

  it("allows one delivery per (email, endpoint), and any number of test events (email_id NULL)", async () => {
    const endpoint = await repository.insertEndpoint("u1", { url: "a", secret: "s" });
    await insertDelivery("d1", endpoint.id, "e1", 1000);

    await expect(insertDelivery("d2", endpoint.id, "e1", 2000)).rejects.toThrow(/UNIQUE/);
    const ignored = await d1
      .prepare(
        `INSERT INTO "webhook_deliveries" (id, endpoint_id, email_id, event_type) VALUES ('d3', ?1, 'e1', 'email.sent')
         ON CONFLICT DO NOTHING`,
      )
      .bind(endpoint.id)
      .run();
    expect(ignored.meta.changes).toBe(0);

    await insertDelivery("t1", endpoint.id, null, 3000);
    await insertDelivery("t2", endpoint.id, null, 4000);
  });

  it("pages the deliveries newest first, with a status filter and a (created_at, id) cursor", async () => {
    const endpoint = await repository.insertEndpoint("u1", { url: "a", secret: "s" });
    const other = await repository.insertEndpoint("u1", { url: "b", secret: "s" });
    await insertDelivery("a", endpoint.id, "e1", 1000);
    await insertDelivery("b", endpoint.id, "e2", 2000, "failed");
    await insertDelivery("c", endpoint.id, "e3", 2000);
    await insertDelivery("d", endpoint.id, "e4", 3000);
    await insertDelivery("x", other.id, "e5", 9000);

    const firstPage = await repository.listDeliveries(endpoint.id, { limit: 2 });
    expect(firstPage.map((d) => d.id)).toEqual(["d", "c"]);

    const next = await repository.listDeliveries(endpoint.id, {
      limit: 10,
      after: { createdAt: firstPage[1].createdAt, id: firstPage[1].id },
    });
    expect(next.map((d) => d.id)).toEqual(["b", "a"]);

    const failed = await repository.listDeliveries(endpoint.id, { limit: 10, status: "failed" });
    expect(failed.map((d) => d.id)).toEqual(["b"]);
    expect(failed[0]).toMatchObject({ eventType: "email.sent", status: "failed", attempts: 0, emailId: "e2" });
  });
});

describe("key rotation covers the webhook columns (real D1)", () => {
  const OLD_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const NEW_KEY = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
  let mf: Miniflare;
  let d1: D1Database;

  beforeAll(async () => {
    ({ mf, d1 } = await createTestD1());
  });

  afterAll(async () => {
    await cleanupTestD1(mf);
  });

  it("lists url, secret and previous_secret in ENCRYPTED_COLUMNS", () => {
    const webhookColumns = ENCRYPTED_COLUMNS.filter((c) => c.table === "webhook_endpoints").map((c) => c.column);
    expect(webhookColumns.sort()).toEqual(["previous_secret", "secret", "url"]);
  });

  it("re-encrypts them with the current key, and skips a NULL previous_secret", async () => {
    await d1.prepare(`INSERT INTO "user" (id, email, email_verified, created_at, updated_at) VALUES ('u1', 'a@b.c', 1, 0, 0)`).run();
    await d1
      .prepare(`INSERT INTO "webhook_endpoints" (id, user_id, url, secret, previous_secret) VALUES ('w1', 'u1', ?1, ?2, ?3), ('w2', 'u1', ?4, ?5, NULL)`)
      .bind(
        await encrypt("https://a.example.com/", OLD_KEY),
        await encrypt("whsec_new", OLD_KEY),
        await encrypt("whsec_old", OLD_KEY),
        await encrypt("https://b.example.com/", OLD_KEY),
        await encrypt("whsec_b", OLD_KEY),
      )
      .run();

    const report = await new KeyRotationService(
      new KeyRotationRepository(d1),
      { current: NEW_KEY, previous: [OLD_KEY] },
      ENCRYPTED_COLUMNS,
    ).run();
    expect(report).toEqual({ reEncrypted: 5, failed: 0, remaining: 0 });

    const kid = await keyId(NEW_KEY);
    const w1 = await d1.prepare(`SELECT * FROM "webhook_endpoints" WHERE id = 'w1'`).first<Record<string, string>>();
    const w2 = await d1.prepare(`SELECT * FROM "webhook_endpoints" WHERE id = 'w2'`).first<Record<string, string | null>>();
    for (const value of [w1!.url, w1!.secret, w1!.previous_secret]) expect(JSON.parse(value).kid).toBe(kid);
    expect(await decrypt(w1!.previous_secret, NEW_KEY)).toBe("whsec_old");
    expect(w2!.previous_secret).toBeNull();
  });
});
