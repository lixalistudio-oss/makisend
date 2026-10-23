/**
 * POST /smtp-config/:id/test-send, through the real app and a real D1.
 *
 *  H1  No session: 401.
 *  H2  A bad body: 400 with the field errors, and nothing is sent.
 *  H3  A configuration that does not exist: 404; one that belongs to someone else: 403.
 *      A user cannot send through another user's SMTP account.
 *  H4  A configuration that cannot connect: 200 with `ok: false`, a reason and a message
 *      (the send ran; `ok` says what happened), and no secret in the answer.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestD1, cleanupTestD1 } from "../../helpers/d1-setup";
import { app } from "@/index";
import type { Bindings } from "@/index";
import { createDatabase } from "@/db/connection";
import { smtpConfig, user } from "@/db/schema";
import { encrypt } from "@/core/crypto";

const AES_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const ORIGIN = "http://localhost:4321";
const PASSWORD = "password123";
const SMTP_PASSWORD = "very-secret-smtp-password";

let env: Bindings;
let mf: Parameters<typeof cleanupTestD1>[0];
let ownerCookie = "";
let configId = "";
let strangerConfigId = "";

const json = (body: unknown) => JSON.stringify(body);

// Registration is closed once a user exists, so only the owner signs up; the other user is written to D1.
async function signUp(email: string): Promise<string> {
  const res = await app.request(
    "/api/auth/sign-up/email",
    { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: json({ email, password: PASSWORD }) },
    env,
  );
  expect(res.status).toBe(200);
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  const cookies = h.getSetCookie ? h.getSetCookie() : [h.get("set-cookie")];
  return cookies.map((c) => (c ?? "").split(";")[0]).join("; ");
}

const testSend = (id: string, cookie: string | null, body: unknown) =>
  app.request(
    `/smtp-config/${id}/test-send`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) },
      body: json(body),
    },
    env,
  );

describe("POST /smtp-config/:id/test-send", () => {
  beforeAll(async () => {
    const testD1 = await createTestD1();
    mf = testD1.mf;
    env = {
      AES_256_KEY: AES_KEY,
      makisend_db: testD1.d1,
      BETTER_AUTH_SECRET: "test-secret",
      BETTER_AUTH_URL: "http://localhost:8787",
      FRONTEND_URL: ORIGIN,
      RATE_LIMIT: "off",
    } as unknown as Bindings;

    ownerCookie = await signUp("owner@example.com");

    const db = createDatabase(testD1.d1);
    await db.insert(user).values({ id: "stranger-id", name: "Stranger", email: "stranger@example.com", emailVerified: true });
    strangerConfigId = "stranger-config-id";
    await db.insert(smtpConfig).values({
      id: strangerConfigId,
      userId: "stranger-id",
      smtpHostname: await encrypt("smtp.stranger.example", AES_KEY),
      smtpUsername: await encrypt("stranger", AES_KEY),
      smtpPassword: await encrypt("stranger-pass", AES_KEY),
      senderEmail: await encrypt("stranger@example.com", AES_KEY),
    });

    const created = await app.request(
      "/smtp-config",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: ownerCookie },
        body: json({
          smtpHostname: "no-such-host.invalid",
          smtpPort: 587,
          smtpSecurity: "starttls",
          smtpUsername: "user@example.com",
          smtpPassword: SMTP_PASSWORD,
          senderEmail: "sender@example.com",
        }),
      },
      env,
    );
    expect(created.status).toBe(201);
    configId = ((await created.json()) as { config: { id: string } }).config.id;
  });

  afterAll(async () => {
    await cleanupTestD1(mf);
  });

  it("H1 refuses a request with no session", async () => {
    const res = await testSend(configId, null, { to: "dest@example.com" });
    expect(res.status).toBe(401);
  });

  it("H2 refuses a bad body with the field errors", async () => {
    const res = await testSend(configId, ownerCookie, { to: "not-an-email" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { details: { fieldErrors: { to?: string[] } } };
    expect(body.details.fieldErrors.to?.[0]).toMatch(/recipient/);
  });

  it("H2 refuses a sender override and unknown fields", async () => {
    const res = await testSend(configId, ownerCookie, { to: "dest@example.com", from: "ceo@example.com" });
    expect(res.status).toBe(400);
  });

  it("H3 answers 404 for a configuration that does not exist", async () => {
    const res = await testSend("does-not-exist", ownerCookie, { to: "dest@example.com" });
    expect(res.status).toBe(404);
  });

  it("H3 answers 403 for another user's configuration", async () => {
    const res = await testSend(strangerConfigId, ownerCookie, { to: "dest@example.com" });
    expect(res.status).toBe(403);
  });

  it("H4 a configuration that cannot connect answers 200 with ok:false, a reason, and no secret", async () => {
    const res = await testSend(configId, ownerCookie, { to: "dest@example.com" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; reason?: string; message?: string };
    expect(body.ok).toBe(false);
    expect(["host_not_found", "cannot_connect", "connection_timeout"]).toContain(body.reason);
    expect(typeof body.message).toBe("string");
    const text = JSON.stringify(body);
    expect(text).not.toContain(SMTP_PASSWORD);
    expect(text).not.toContain("user@example.com");
  }, 30_000);

  it("L1 a test is written to the email logs, with its failure, readable by its owner and nobody else", async () => {
    const before = ((await (await app.request("/email-logs", { headers: { Origin: ORIGIN, Cookie: ownerCookie } }, env)).json()) as { logs?: unknown[] }).logs ?? [];
    await testSend(configId, ownerCookie, { to: "dest@example.com", subject: "Log me" });

    const res = await app.request("/email-logs", { headers: { Origin: ORIGIN, Cookie: ownerCookie } }, env);
    expect(res.status).toBe(200);
    const { logs } = (await res.json()) as { logs: { subject: string; to: string; source: string; smtpConfigId: string | null; apiKeyId: string | null; history: { status: string; error: string | null }[] }[] };
    const mine = logs.filter((l) => l.subject === "Log me");
    expect(mine).toHaveLength(1);
    expect(logs.length).toBe(before.length + 1);
    const [log] = mine;
    expect(log.source).toBe("test");
    expect(log.smtpConfigId).toBe(configId);
    expect(log.apiKeyId).toBeNull();
    expect(log.to, "the recipient is stored encrypted and shown decrypted").toBe("dest@example.com");
    expect(log.history.map((h) => h.status)).toEqual(["processing", "failed"]);
    const failure = log.history.at(-1)?.error ?? "";
    expect(failure.length).toBeGreaterThan(0);
    expect(failure, "the stored reason names no secret").not.toContain(SMTP_PASSWORD);
    expect(failure).not.toContain("user@example.com");

    // The filter by configuration finds it, the dashboard totals do not count it.
    const filtered = await app.request(`/email-logs?smtpConfigId=${configId}`, { headers: { Origin: ORIGIN, Cookie: ownerCookie } }, env);
    expect(((await filtered.json()) as { logs: { subject: string }[] }).logs.some((l) => l.subject === "Log me")).toBe(true);
    const stats = await app.request("/dashboard/stats", { headers: { Origin: ORIGIN, Cookie: ownerCookie } }, env);
    expect(((await stats.json()) as { totalSent?: number }).totalSent ?? 0).toBe(0);
  }, 30_000);

  it("L2 a refused body (400) writes nothing to the logs", async () => {
    const count = async () => ((await (await app.request("/email-logs", { headers: { Origin: ORIGIN, Cookie: ownerCookie } }, env)).json()) as { logs: unknown[] }).logs.length;
    const before = await count();
    expect((await testSend(configId, ownerCookie, { to: "not-an-email" })).status).toBe(400);
    expect(await count()).toBe(before);
  });
});
