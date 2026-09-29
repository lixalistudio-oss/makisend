import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestD1, cleanupTestD1 } from "../../helpers/d1-setup";
import app from "@/index";
import type { Bindings } from "@/index";

const BASE_URL = "http://localhost:8787";
const ORIGIN = "http://localhost:4321";
const EMAIL = "first-user@example.com";
const PASSWORD = "password123";

// getAuthInstance() caches the Better Auth singleton per BETTER_AUTH_URL, so the whole
// file must share a single D1 database: a fresh Miniflare instance per test would leave
// the cached auth bound to a disposed database.
let env: Bindings;
let mf: Parameters<typeof cleanupTestD1>[0];

const signUp = () =>
  app.request(
    "/api/auth/sign-up/email",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    },
    env,
  );

const signIn = (email: string, password: string) =>
  app.request(
    "/api/auth/sign-in/email",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: JSON.stringify({ email, password }),
    },
    env,
  );

describe("auth routes (email + password only)", () => {
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
      BETTER_AUTH_URL: BASE_URL,
    } as unknown as Bindings;
  });

  afterAll(async () => {
    await cleanupTestD1(mf);
  });

  it("signs up with email and password only, without asking for a name", async () => {
    const res = await signUp();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.user.email).toBe(EMAIL);
    // name is filled in by the backend from the email local part
    expect(body.user.name).toBe("first-user");
    expect(res.headers.get("set-cookie")).toBeTruthy();
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("closes registration once a user exists", async () => {
    const res = await signUp();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Registration is closed" });
  });

  it("signs in with valid credentials and sets a session cookie", async () => {
    const res = await signIn(EMAIL, PASSWORD);

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeTruthy();
    expect((await res.json()).user.email).toBe(EMAIL);
  });

  it("returns 401 with a JSON body for invalid credentials", async () => {
    const res = await signIn(EMAIL, "wrong-password");
    const text = await res.text();

    expect(res.status).toBe(401);
    // an empty body would make res.json() throw on the frontend
    expect(text).not.toBe("");
    expect(JSON.parse(text).message).toBe("Invalid email or password");
  });
});
