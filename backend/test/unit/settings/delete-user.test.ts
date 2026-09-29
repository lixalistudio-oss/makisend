import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestD1, cleanupTestD1 } from "../../helpers/d1-setup";
import { createDatabase } from "@/db/connection";
import { emailLogs, smtpConfig, user } from "@/db/schema";
import app from "@/index";
import type { Bindings } from "@/index";

const ORIGIN = "http://localhost:4321";
const EMAIL = "deleteme@example.com";
const PASSWORD = "password123";

let env: Bindings;
let mf: Parameters<typeof cleanupTestD1>[0];
let cookie = "";
const json = (b: unknown) => JSON.stringify(b);

describe("POST /api/auth/delete-user with owned data", () => {
  beforeAll(async () => {
    const testD1 = await createTestD1();
    mf = testD1.mf;
    env = {
      AES_256_KEY:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      makisend_db: testD1.d1,
      PORT: 587,
      INNGEST_DEV: 1,
      BETTER_AUTH_SECRET: "test-secret",
      BETTER_AUTH_URL: "http://localhost:8787",
      FRONTEND_URL: ORIGIN,
    } as unknown as Bindings;

    const res = await app.request(
      "/api/auth/sign-up/email",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGIN },
        body: json({ email: EMAIL, password: PASSWORD }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const h = res.headers as Headers & { getSetCookie?: () => string[] };
    cookie = (h.getSetCookie ? h.getSetCookie() : [h.get("set-cookie")])
      .map((c) => (c ?? "").split(";")[0])
      .join("; ");

    // a full data chain: smtp config -> api key -> email log
    const cfgRes = await app.request(
      "/smtp-config",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: cookie },
        body: json({
          smtpHostname: "smtp.example.com",
          smtpUsername: "u@example.com",
          smtpPassword: "pw",
          senderEmail: "s@example.com",
        }),
      },
      env,
    );
    expect(cfgRes.status).toBe(201);
    const cfg = ((await cfgRes.json()) as { config: { id: string } }).config;

    const keyRes = await app.request(
      "/api-keys",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: cookie },
        body: json({ smtpConfigId: cfg.id, name: "k" }),
      },
      env,
    );
    expect(keyRes.status).toBe(201);
    const keyId = ((await keyRes.json()) as { record: { id: string } }).record.id;

    await createDatabase(env.makisend_db).insert(emailLogs).values({
      userId: (await createDatabase(env.makisend_db).select().from(smtpConfig))[0].userId,
      apiKeyId: keyId,
      to: "to@example.com",
      subject: "hi",
      smtpId: cfg.id,
      sentAt: new Date().toISOString(),
    });
  });

  afterAll(async () => {
    await cleanupTestD1(mf);
  });

  it("deletes the account", { timeout: 30000 }, async () => {
    const before = await createDatabase(env.makisend_db).select().from(emailLogs);
    expect(before).toHaveLength(1);

    const res = await app.request(
      "/api/auth/delete-user",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: cookie },
        body: json({ password: PASSWORD }),
      },
      env,
    );
    const body = await res.text();
    expect(res.status, body).toBe(200);

    const db = createDatabase(env.makisend_db);
    const logs = await db.select().from(emailLogs);
    const users = await db.select().from(user);

    expect(logs).toHaveLength(0);
    expect(users).toHaveLength(0);
  });
});
