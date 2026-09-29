import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestD1, cleanupTestD1 } from "../../helpers/d1-setup";
import app from "@/index";
import type { Bindings } from "@/index";

const ORIGIN = "http://localhost:4321";
const EMAIL = "owner@example.com";
const PASSWORD = "password123";

// deps.initDb() is a one-shot module singleton, so the whole file must share one D1.
let env: Bindings;
let mf: Parameters<typeof cleanupTestD1>[0];
let cookie = "";

const json = (body: unknown) => JSON.stringify(body);

const smtpPayload = {
  smtpHostname: "smtp.example.com",
  smtpUsername: "user@example.com",
  smtpPassword: "secret",
  senderEmail: "sender@example.com",
};

describe("POST /smtp-config", () => {
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
    const cookies = h.getSetCookie ? h.getSetCookie() : [h.get("set-cookie")];
    cookie = cookies.map((c) => c.split(";")[0]).join("; ");
    expect(cookie).toContain("session_token");
  });

  afterAll(async () => {
    await cleanupTestD1(mf);
  });

  it("rejects unauthenticated requests", async () => {
    const res = await app.request(
      "/smtp-config",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGIN },
        body: json(smtpPayload),
      },
      env,
    );

    expect(res.status).toBe(401);
    // without this the browser hides the 401 from the frontend as a CORS failure
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("creates a config bound to the session user", async () => {
    const res = await app.request(
      "/smtp-config",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: ORIGIN,
          Cookie: cookie,
        },
        body: json(smtpPayload),
      },
      env,
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.config.userId).toBeTruthy();
    expect(body.config.senderEmail).toBe(smtpPayload.senderEmail);
  });

  it("lists only the configs of the session user", async () => {
    const res = await app.request(
      "/smtp-config",
      {
        method: "GET",
        headers: { Origin: ORIGIN, Cookie: cookie },
      },
      env,
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.configs).toHaveLength(1);
    expect(body.configs[0].senderEmail).toBe(smtpPayload.senderEmail);
  });
});
