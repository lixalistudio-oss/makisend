import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestD1, cleanupTestD1 } from "../../helpers/d1-setup";
import { app } from "@/index";
import type { Bindings } from "@/index";

const DASHBOARD = "https://dashboard.example.com";
const EVIL = "https://evil.example";
const BASE_URL = "https://api.example.com";

let env: Bindings;
let mf: Parameters<typeof cleanupTestD1>[0];

// One database for the whole file: getAuthInstance() caches the Better Auth singleton.
beforeAll(async () => {
  const testD1 = await createTestD1();
  mf = testD1.mf;
  env = {
    AES_256_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    makisend_db: testD1.d1,
    BETTER_AUTH_SECRET: "test-secret-for-security-tests",
    BETTER_AUTH_URL: BASE_URL,
    FRONTEND_URL: DASHBOARD,
    // RATE_LIMIT is deliberately left unset: the limiter must be ON by default.
  } as unknown as Bindings;
});

afterAll(async () => {
  await cleanupTestD1(mf);
});

const signIn = (headers: Record<string, string>) =>
  app.request(
    "/api/auth/sign-in/email",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: DASHBOARD, ...headers },
      body: JSON.stringify({ email: "nobody@example.com", password: "wrong-password" }),
    },
    env,
  );

describe("CORS: only the dashboard origin may use credentials", () => {
  it("answers the dashboard origin with credentials allowed", async () => {
    const res = await app.request("/smtp-config", { headers: { Origin: DASHBOARD } }, env);

    expect(res.headers.get("access-control-allow-origin")).toBe(DASHBOARD);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("tolerates a trailing slash in FRONTEND_URL", async () => {
    const res = await app.request(
      "/smtp-config",
      { headers: { Origin: DASHBOARD } },
      { ...env, FRONTEND_URL: `${DASHBOARD}/` },
    );

    expect(res.headers.get("access-control-allow-origin")).toBe(DASHBOARD);
  });

  it.each([
    ["a foreign website", EVIL],
    ["a look-alike of the dashboard", `${DASHBOARD}.evil.example`],
    ["the dashboard over http", "http://dashboard.example.com"],
  ])("gives %s no CORS headers on a normal request", async (_label, origin) => {
    const res = await app.request("/smtp-config", { headers: { Origin: origin } }, env);

    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("gives a foreign website no CORS headers on a preflight", async () => {
    const res = await app.request(
      "/smtp-config",
      {
        method: "OPTIONS",
        headers: { Origin: EVIL, "Access-Control-Request-Method": "GET" },
      },
      env,
    );

    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("gives a foreign website no CORS headers on the auth routes either", async () => {
    const res = await app.request(
      "/api/auth/get-session",
      { headers: { Origin: EVIL } },
      env,
    );

    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("allows nobody when FRONTEND_URL is not configured", async () => {
    const res = await app.request(
      "/smtp-config",
      { headers: { Origin: DASHBOARD } },
      { ...env, FRONTEND_URL: "" },
    );

    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("security headers", () => {
  it("are set on every response, errors included", async () => {
    const res = await app.request("/smtp-config", { headers: { Origin: DASHBOARD } }, env);

    expect(res.status).toBe(401);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(res.headers.get("strict-transport-security")).toContain("max-age=");
  });

  it("are also set on the Better Auth routes", async () => {
    const res = await app.request("/api/auth/get-session", { headers: { Origin: DASHBOARD } }, env);

    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("sign-in rate limiting (on by default)", () => {
  it("blocks the 4th attempt within 10 seconds from the same address", async () => {
    const headers = { "cf-connecting-ip": "203.0.113.10" };
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await signIn(headers)).status);

    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses.slice(3)).toEqual([429, 429]);
  });

  it("counts addresses separately", async () => {
    const res = await signIn({ "cf-connecting-ip": "203.0.113.20" });

    expect(res.status).toBe(401);
  });

  it("cannot be dodged by spoofing X-Forwarded-For: only cf-connecting-ip is trusted", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      statuses.push(
        (await signIn({ "cf-connecting-ip": "203.0.113.30", "x-forwarded-for": `198.51.100.${i}` })).status,
      );
    }

    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses.slice(3)).toEqual([429, 429]);
  });
});
