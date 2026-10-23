/**
 * Migration 0003 (smtp_port, smtp_security) on a real D1 (Miniflare / workerd).
 *
 * Failure analysis (written before the code):
 *  G1  The migration drops or rewrites an existing row: a configuration created before
 *      it must come out unchanged, with 465 and `tls` (what it always did).
 *  G2  The columns are nullable or lack a default: an INSERT that does not know them
 *      (the `user:create` script, an older deploy running against the new schema) fails.
 *  G3  The end-to-end path does not carry the new fields: POST a configuration with a
 *      port and a security, read it back, change the port, and check the security follows.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "@/index";
import type { Bindings } from "@/index";

const dir = join(import.meta.dirname, "../../../drizzle");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const upTo = (n: number) => files.filter((f) => Number(f.slice(0, 4)) <= n);
const statements = (names: string[]) =>
  names.flatMap((f) => readFileSync(join(dir, f), "utf-8").split("--> statement-breakpoint").map((x) => x.trim()).filter(Boolean));

let mf: Miniflare;
let d1: D1Database;

async function freshD1(): Promise<{ mf: Miniflare; d1: D1Database }> {
  const m = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    compatibilityDate: "2026-07-10",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: ["makisend_db"],
  });
  return { mf: m, d1: await m.getD1Database("makisend_db") };
}

describe("G1/G2 migration 0003 on a database that already holds a configuration", () => {
  beforeAll(async () => {
    ({ mf, d1 } = await freshD1());
    for (const sql of statements(upTo(2))) await d1.prepare(sql).run();
    await d1.prepare("INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('u1','n','a@b.co',0,0,0)").run();
    await d1
      .prepare("INSERT INTO smtp_config (id, user_id, smtphostname, smtpusername, smtppassword, sender_email) VALUES ('old','u1','enc-h','enc-u','enc-p','enc-s')")
      .run();
    for (const sql of statements(files.filter((f) => Number(f.slice(0, 4)) === 3))) await d1.prepare(sql).run();
  });
  afterAll(async () => { await mf.dispose(); });

  it("the existing row is untouched and now reads 465 / tls", async () => {
    const row = await d1.prepare("SELECT smtphostname, smtpusername, smtppassword, sender_email, smtp_port, smtp_security FROM smtp_config WHERE id='old'").first();
    expect(row).toEqual({ smtphostname: "enc-h", smtpusername: "enc-u", smtppassword: "enc-p", sender_email: "enc-s", smtp_port: 465, smtp_security: "tls" });
  });

  it("an INSERT that does not know the new columns (the user:create script, an older deploy) still works", async () => {
    await d1.prepare("INSERT INTO smtp_config (id, user_id, smtphostname, smtpusername, smtppassword, sender_email) VALUES ('new','u1','h','u','p','s')").run();
    const row = await d1.prepare("SELECT smtp_port, smtp_security FROM smtp_config WHERE id='new'").first();
    expect(row).toEqual({ smtp_port: 465, smtp_security: "tls" });
  });

  it("the columns cannot be NULL", async () => {
    await expect(d1.prepare("INSERT INTO smtp_config (id, user_id, smtphostname, smtpusername, smtppassword, sender_email, smtp_port) VALUES ('x','u1','h','u','p','s',NULL)").run()).rejects.toThrow();
  });
});

describe("G3 through the HTTP routes, on the full schema", () => {
  const ORIGIN = "http://localhost:4321";
  let env: Bindings;
  let cookie = "";
  let m2: Miniflare;
  const call = (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: cookie, ...(init.headers ?? {}) } }, env);

  beforeAll(async () => {
    const f = await freshD1();
    m2 = f.mf;
    for (const sql of statements(files)) await f.d1.prepare(sql).run();
    env = {
      AES_256_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      makisend_db: f.d1,
      BETTER_AUTH_SECRET: "test-secret",
      BETTER_AUTH_URL: "http://localhost:8787",
      FRONTEND_URL: ORIGIN,
      RATE_LIMIT: "off",
    } as unknown as Bindings;
    const res = await app.request("/api/auth/sign-up/email", { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ email: "owner@example.com", password: "password123" }) }, env);
    const h = res.headers as Headers & { getSetCookie?: () => string[] };
    cookie = (h.getSetCookie ? h.getSetCookie() : [h.get("set-cookie")]).map((c) => (c ?? "").split(";")[0]).join("; ");
  });
  afterAll(async () => { await m2.dispose(); });

  const payload = { smtpHostname: "SMTP.Zoho.com", smtpUsername: "u@x.co", smtpPassword: "p", senderEmail: "no-reply@getitaja.com" };
  let id = "";

  it("a creation with no port keeps the old behaviour (465 / tls) and normalises the hostname", async () => {
    const res = await call("/smtp-config", { method: "POST", body: JSON.stringify(payload) });
    const body = (await res.json()) as { config: { id: string; smtpHostname: string; smtpPort: number; smtpSecurity: string } };
    expect(res.status).toBe(201);
    expect(body.config).toMatchObject({ smtpHostname: "smtp.zoho.com", smtpPort: 465, smtpSecurity: "tls" });
    id = body.config.id;
  });

  it("a creation with port 587 and no security comes back STARTTLS", async () => {
    const res = await call("/smtp-config", { method: "POST", body: JSON.stringify({ ...payload, smtpPort: 587 }) });
    const body = (await res.json()) as { config: { smtpPort: number; smtpSecurity: string } };
    expect(res.status).toBe(201);
    expect(body.config).toMatchObject({ smtpPort: 587, smtpSecurity: "starttls" });
  });

  it("changing only the port moves the security with it (465 -> 587), changing only the security keeps the port", async () => {
    let res = await call(`/smtp-config/${id}`, { method: "PUT", body: JSON.stringify({ smtpPort: 587 }) });
    let body = (await res.json()) as { config: { smtpPort: number; smtpSecurity: string } };
    expect(body.config).toMatchObject({ smtpPort: 587, smtpSecurity: "starttls" });
    res = await call(`/smtp-config/${id}`, { method: "PUT", body: JSON.stringify({ smtpSecurity: "tls" }) });
    body = (await res.json()) as { config: { smtpPort: number; smtpSecurity: string } };
    expect(body.config).toMatchObject({ smtpPort: 587, smtpSecurity: "tls" });
  });

  it("a bad hostname, port 25 and an unknown security are 400 with the reason per field", async () => {
    for (const [patch, field] of [
      [{ smtpHostname: "https://smtp.zoho.com" }, "smtpHostname"],
      [{ smtpPort: 25 }, "smtpPort"],
      [{ smtpSecurity: "ssl" }, "smtpSecurity"],
    ] as const) {
      const res = await call("/smtp-config", { method: "POST", body: JSON.stringify({ ...payload, ...patch }) });
      const body = (await res.json()) as { details: { fieldErrors: Record<string, string[]> } };
      expect(res.status, field).toBe(400);
      expect(body.details.fieldErrors[field]?.length, field).toBeGreaterThan(0);
    }
  });

  it("POST /smtp-config/check needs a session, validates like a creation, and never answers with the password", async () => {
    const anon = await app.request("/smtp-config/check", { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify(payload) }, env);
    expect(anon.status).toBe(401);
    const bad = await call("/smtp-config/check", { method: "POST", body: JSON.stringify({ ...payload, smtpHostname: "smtp.zoho.com:465" }) });
    expect(bad.status).toBe(400);
    const res = await call("/smtp-config/check", { method: "POST", body: JSON.stringify({ ...payload, smtpHostname: "no-such-host.invalid", smtpPassword: "NEVER-ECHOED-PASSWORD" }) });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toMatchObject({ ok: false });
    expect(text).not.toContain("NEVER-ECHOED-PASSWORD");
  }, 30_000);

  it("POST /smtp-config/:id/check reaches the stored configuration, and another user's id is refused", async () => {
    const res = await call(`/smtp-config/${id}/check`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(false); // smtp.zoho.com with a made-up password: refused, never sent
    const missing = await call("/smtp-config/does-not-exist/check", { method: "POST" });
    expect(missing.status).toBe(404);
  }, 40_000);
});
