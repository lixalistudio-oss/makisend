import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestD1, cleanupTestD1 } from "../../helpers/d1-setup";
import { app } from "@/index";
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

describe("SMTP config HTTP", () => {
  beforeAll(async () => {
    const testD1 = await createTestD1();
    mf = testD1.mf;
    env = {
      AES_256_KEY:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      makisend_db: testD1.d1,
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
    cookie = cookies.map((c) => (c ?? "").split(";")[0]).join("; ");
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
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("creates a config bound to the session user with default TLS on 465", async () => {
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
    const body = (await res.json()) as {
      config: { userId: string; senderEmail: string; smtpPort: number; smtpSecurity: string };
    };

    expect(res.status).toBe(201);
    expect(body.config.userId).toBeTruthy();
    expect(body.config.senderEmail).toBe(smtpPayload.senderEmail);
    expect(body.config.smtpPort).toBe(465);
    expect(body.config.smtpSecurity).toBe("tls");
    expect(body.config).not.toHaveProperty("smtpPassword");
  });

  it("rejects a hostname with a scheme or a port", async () => {
    const res = await app.request(
      "/smtp-config",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: ORIGIN,
          Cookie: cookie,
        },
        body: json({ ...smtpPayload, smtpHostname: "smtp.example.com:465" }),
      },
      env,
    );

    expect(res.status).toBe(400);
  });

  it("rejects port 25, which Workers cannot reach", async () => {
    const res = await app.request(
      "/smtp-config",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: ORIGIN,
          Cookie: cookie,
        },
        body: json({ ...smtpPayload, smtpPort: 25 }),
      },
      env,
    );

    expect(res.status).toBe(400);
  });

  it("derives STARTTLS when port 587 is supplied without a security", async () => {
    const res = await app.request(
      "/smtp-config",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: ORIGIN,
          Cookie: cookie,
        },
        body: json({ ...smtpPayload, smtpHostname: "smtp.starttls.example.com", smtpPort: 587 }),
      },
      env,
    );
    const body = (await res.json()) as { config: { smtpPort: number; smtpSecurity: string } };

    expect(res.status).toBe(201);
    expect(body.config.smtpPort).toBe(587);
    expect(body.config.smtpSecurity).toBe("starttls");
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
    const body = (await res.json()) as { configs: { senderEmail: string }[] };

    expect(res.status).toBe(200);
    expect(body.configs).toHaveLength(2);
    expect(body.configs.map((config) => config.senderEmail)).toContain(smtpPayload.senderEmail);
    expect(body.configs[0]).not.toHaveProperty("smtpPassword");
  });

  it("requires a session for the unsaved check", async () => {
    const res = await app.request(
      "/smtp-config/check",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGIN },
        body: json(smtpPayload),
      },
      env,
    );

    expect(res.status).toBe(401);
  });

  it("validates the unsaved check like a creation", async () => {
    const res = await app.request(
      "/smtp-config/check",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: ORIGIN,
          Cookie: cookie,
        },
        body: json({ ...smtpPayload, smtpHostname: "https://smtp.example.com" }),
      },
      env,
    );

    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown saved configuration", async () => {
    const res = await app.request(
      "/smtp-config/does-not-exist/check",
      {
        method: "POST",
        headers: { Origin: ORIGIN, Cookie: cookie },
      },
      env,
    );

    expect(res.status).toBe(404);
  });

  it("validates the test-send recipient", async () => {
    const res = await app.request(
      "/smtp-config/does-not-exist/test-send",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: ORIGIN,
          Cookie: cookie,
        },
        body: json({ to: "not-an-email" }),
      },
      env,
    );

    expect(res.status).toBe(400);
  });

  it("returns 404 for test-send on an unknown configuration", async () => {
    const res = await app.request(
      "/smtp-config/does-not-exist/test-send",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: ORIGIN,
          Cookie: cookie,
        },
        body: json({ to: "dest@example.com" }),
      },
      env,
    );

    expect(res.status).toBe(404);
  });
});
