import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestD1, cleanupTestD1 } from "../../helpers/d1-setup";
import { app } from "@/index";
import type { Bindings } from "@/index";

const BASE_URL = "http://localhost:8787";
const ORIGIN = "http://localhost:4321";
const EMAIL = "settings-user@example.com";
const NEW_EMAIL = "settings-user-updated@example.com";
const PASSWORD = "password123";
const NEW_PASSWORD = "new-password-456";

let env: Bindings;
let mf: Parameters<typeof cleanupTestD1>[0];
let cookie = "";
const json = (b: unknown) => JSON.stringify(b);

const authed = (path: string, body: unknown) =>
  app.request(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: cookie },
      body: json(body),
    },
    env,
  );

const signIn = (email: string, password: string) =>
  app.request(
    "/api/auth/sign-in/email",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: json({ email, password }),
    },
    env,
  );

const getSession = () =>
  app.request(
    "/api/auth/get-session",
    { headers: { Origin: ORIGIN, Cookie: cookie } },
    env,
  );

async function sessionEmail(): Promise<string | undefined> {
  const res = await getSession();
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data?: { user?: { email?: string } }; user?: { email?: string } };
  return (body.data?.user ?? body.user)?.email;
}

describe("settings account routes", () => {
  beforeAll(async () => {
    const testD1 = await createTestD1();
    mf = testD1.mf;
    env = {
      AES_256_KEY:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      makisend_db: testD1.d1,
      PORT: 587,
      BETTER_AUTH_SECRET: "test-secret",
      BETTER_AUTH_URL: BASE_URL,
      FRONTEND_URL: ORIGIN,
      // This suite exercises account settings, not brute-force protection.
      RATE_LIMIT: "off",
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
  }, 30_000);

  afterAll(async () => {
    await cleanupTestD1(mf);
  });

  it("reports the signed-in email on get-session", async () => {
    expect(await sessionEmail()).toBe(EMAIL);
  });

  it("updates the email via /api/auth/change-email", async () => {
    const res = await authed("/api/auth/change-email", { newEmail: NEW_EMAIL });
    const body = (await res.json()) as { status?: boolean };

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.status).toBe(true);
    expect(await sessionEmail()).toBe(NEW_EMAIL);
  });

  it("rejects a malformed email", async () => {
    const res = await authed("/api/auth/change-email", { newEmail: "not-an-email" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await sessionEmail()).toBe(NEW_EMAIL);
  });

  it("changes the password via /api/auth/change-password", async () => {
    const res = await authed("/api/auth/change-password", {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    expect(res.status, await res.clone().text()).toBe(200);
    expect(await (await getSession()).json()).toBeTruthy();
  });

  it("rejects /api/auth/change-password with a wrong current password", async () => {
    const res = await authed("/api/auth/change-password", {
      currentPassword: "totally-wrong",
      newPassword: "another-password-1",
    });
    const body = (await res.json()) as { message?: string };

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(body.message).toBeTruthy();
    // the rejected attempt must not have changed the password
    expect((await signIn(NEW_EMAIL, NEW_PASSWORD)).status).toBe(200);
  });

  it("signs in with the updated email and new password", async () => {
    const bad = await signIn(NEW_EMAIL, PASSWORD);
    expect(bad.status).toBe(401);

    const good = await signIn(NEW_EMAIL, NEW_PASSWORD);
    expect(good.status).toBe(200);

    // take a fresh cookie from this sign-in for the deletion test
    const h = good.headers as Headers & { getSetCookie?: () => string[] };
    cookie = (h.getSetCookie ? h.getSetCookie() : [good.headers.get("set-cookie")])
      .map((c) => (c ?? "").split(";")[0])
      .join("; ");
  });

  it("deletes the account via /api/auth/delete-user with a password", async () => {
    const wrong = await authed("/api/auth/delete-user", { password: "nope" });
    expect(wrong.status).toBeGreaterThanOrEqual(400);

    const res = await authed("/api/auth/delete-user", { password: NEW_PASSWORD });
    const body = (await res.json()) as { success?: boolean };

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.success).toBe(true);

    // the account is gone: the old credentials no longer sign in
    expect((await signIn(NEW_EMAIL, NEW_PASSWORD)).status).toBe(401);
    const sessionRes = await getSession();
    const sessionBody = (await sessionRes.json().catch(() => null)) as {
      user?: unknown;
      data?: unknown;
    } | null;
    expect(sessionBody?.user ?? sessionBody?.data ?? null).toBeNull();
  });
});
