/**
 * Account model: one account per instance, its super admin, created at the first connection.
 * Two-factor authentication (TOTP) from Settings, and opt-in sign-in with email + code only.
 *
 * ── Failure analysis (written before the code) ──
 *  A1  A second sign-up succeeds once the admin exists (the single-account rule is bypassed).
 *  A2  Two concurrent first sign-ups both create an account (check-then-insert race on D1).
 *  A3  The lock blocks creation forever after a failed first insert (instance can never be set up).
 *  A4  Deleting the account leaves the instance locked, with nobody able to sign in.
 *  A5  With 2FA on, the password alone yields a session (the second factor is skipped).
 *  A6  Passwordless sign-in works for an account that never opted in, or reveals which emails exist.
 *  A7  A TOTP code is accepted twice (replay), or unlimited wrong codes are allowed (no lockout).
 *  A8  Turning 2FA off leaves passwordless sign-in on.
 *
 * Real Better Auth on a real D1 (Miniflare), through the Worker's Hono app.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createOTP } from "@better-auth/utils/otp";
import { createTestD1, cleanupTestD1 } from "../../helpers/d1-setup";
import { app } from "@/index";
import type { Bindings } from "@/index";
import { claimOwnership, OWNER_CLAIM_TTL_MS, SETUP_COMPLETE_MESSAGE } from "@/lib/owner-lock";
import { INVALID_TOTP_SIGN_IN } from "@/lib/totp-sign-in";

const ORIGIN = "http://localhost:4321";
const EMAIL = "admin@example.com";
const PASSWORD = "password123";
const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

let env: Bindings;
let mf: Parameters<typeof cleanupTestD1>[0];
let d1: D1Database;
// The auth singleton is cached per BETTER_AUTH_URL (src/index.ts): a new URL per test binds it
// to that test's fresh database.
let run = 0;

type Json = Record<string, unknown>;

/** A tiny cookie jar: Better Auth answers with several Set-Cookie headers. */
class Jar {
  private cookies = new Map<string, string>();
  store(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const at = pair.indexOf("=");
      const name = pair.slice(0, at);
      const value = pair.slice(at + 1);
      if (value === "" || /max-age=0/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

async function call(path: string, body?: Json, jar?: Jar) {
  const headers: Record<string, string> = { Origin: ORIGIN };
  if (body) headers["Content-Type"] = "application/json";
  if (jar) headers.Cookie = jar.header();
  const res = await app.request(
    path,
    { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined },
    env,
  );
  jar?.store(res);
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Json | null };
}

const signUp = (email = EMAIL, jar?: Jar) => call("/api/auth/sign-up/email", { email, password: PASSWORD }, jar);
const signIn = (jar: Jar, password = PASSWORD) => call("/api/auth/sign-in/email", { email: EMAIL, password }, jar);
const session = async (jar: Jar) => (await call("/api/auth/get-session", undefined, jar)).body;

/** The secret in the otpauth URI is base32; createOTP takes the raw secret Better Auth stores. */
function base32Decode(input: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of input.replace(/=+$/, "")) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return new TextDecoder().decode(new Uint8Array(bytes));
}
const totp = (uriSecret: string) => createOTP(base32Decode(uriSecret), { digits: 6, period: 30 }).totp();

/** Turns TOTP on for the signed-in account and returns its (base32) secret. */
async function enableTotp(jar: Jar): Promise<string> {
  const enabled = await call("/api/auth/two-factor/enable", { password: PASSWORD }, jar);
  expect(enabled.status).toBe(200);
  const secret = new URL(String(enabled.body!.totpURI)).searchParams.get("secret")!;
  const verified = await call("/api/auth/two-factor/verify-totp", { code: await totp(secret) }, jar);
  expect(verified.status).toBe(200);
  return secret;
}

const userCount = async () =>
  (await d1.prepare(`SELECT COUNT(*) AS n FROM "user"`).first<{ n: number }>())!.n;

beforeEach(async () => {
  const testD1 = await createTestD1();
  mf = testD1.mf;
  d1 = testD1.d1;
  run++;
  env = {
    ENCRYPTION_KEY: KEY,
    makisend_db: d1,
    BETTER_AUTH_SECRET: "test-secret-0123456789-0123456789-abcdef",
    BETTER_AUTH_URL: `http://localhost:${8000 + run}`,
    FRONTEND_URL: ORIGIN,
    // Many sign-ins from one address: the limiter has its own tests (test/unit/security).
    RATE_LIMIT: "off",
  } as Bindings;
});

afterEach(async () => {
  await cleanupTestD1(mf);
});

describe("super admin created at the first connection", () => {
  it("reports the instance as not set up until the first account exists", async () => {
    expect((await call("/api/setup-status")).body).toEqual({ needsSetup: true });
    expect((await signUp()).status).toBe(200);
    expect((await call("/api/setup-status")).body).toEqual({ needsSetup: false });
  });

  it("creates the first account from email + password only, with a session", async () => {
    const jar = new Jar();
    const res = await signUp(EMAIL, jar);

    expect(res.status).toBe(200);
    expect((res.body!.user as Json).email).toBe(EMAIL);
    // name is filled in by the backend from the email local part
    expect((res.body!.user as Json).name).toBe("admin");
    expect(((await session(jar))!.user as Json).email).toBe(EMAIL);
  });

  it("refuses any other account once the admin exists (A1)", async () => {
    await signUp();
    const res = await signUp("intruder@example.com");

    expect(res.status).toBe(403);
    expect(res.body!.message).toBe(SETUP_COMPLETE_MESSAGE);
    expect(await userCount()).toBe(1);
  });

  it("creates a single account when first sign-ups race (A2)", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => signUp(`racer${i}@example.com`)));

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await userCount()).toBe(1);
  });

  it("frees a claim whose account was never created, after the TTL (A3)", async () => {
    const now = Date.now();
    expect(await claimOwnership(d1, now)).toBe(true);
    // Another creation inside the TTL is refused; after it, the claim is taken over.
    expect(await claimOwnership(d1, now + 1)).toBe(false);
    expect(await claimOwnership(d1, now + OWNER_CLAIM_TTL_MS + 1)).toBe(true);
  });

  it("never frees the instance while an account exists, whatever the claim's age (A1)", async () => {
    await signUp();
    expect(await claimOwnership(d1, Date.now() + 10 * OWNER_CLAIM_TTL_MS)).toBe(false);
  });

  it("sets the instance up again after the account is deleted (A4)", async () => {
    const jar = new Jar();
    await signUp(EMAIL, jar);
    const deleted = await call("/api/auth/delete-user", { password: PASSWORD }, jar);
    expect(deleted.status).toBe(200);

    expect((await call("/api/setup-status")).body).toEqual({ needsSetup: true });
    expect((await signUp("new-admin@example.com")).status).toBe(200);
  });

  it("signs in with valid credentials and sets a session cookie", async () => {
    await signUp();
    const jar = new Jar();
    const res = await signIn(jar);

    expect(res.status).toBe(200);
    expect(((await session(jar))!.user as Json).email).toBe(EMAIL);
  });

  it("returns 401 with a JSON body for invalid credentials", async () => {
    await signUp();
    const res = await signIn(new Jar(), "wrong-password");

    expect(res.status).toBe(401);
    expect(res.body!.message).toBe("Invalid email or password");
  });
});

describe("two-factor authentication (TOTP)", () => {
  it("asks for the authenticator code after the password, then opens the session (A5)", async () => {
    const setup = new Jar();
    await signUp(EMAIL, setup);
    const secret = await enableTotp(setup);

    const jar = new Jar();
    const first = await signIn(jar);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ twoFactorRedirect: true, twoFactorMethods: ["totp"] });
    expect(await session(jar)).toBeNull();

    const wrong = await call("/api/auth/two-factor/verify-totp", { code: "000000" }, jar);
    expect(wrong.status).toBe(401);
    expect(await session(jar)).toBeNull();

    const ok = await call("/api/auth/two-factor/verify-totp", { code: await totp(secret) }, jar);
    expect(ok.status).toBe(200);
    expect(((await session(jar))!.user as Json).twoFactorEnabled).toBe(true);
  });

  it("stores the TOTP secret and backup codes encrypted, never in clear", async () => {
    const jar = new Jar();
    await signUp(EMAIL, jar);
    const secret = await enableTotp(jar);

    const row = (await d1
      .prepare(`SELECT secret, backup_codes FROM "two_factor"`)
      .first<{ secret: string; backup_codes: string }>())!;
    expect(row.secret).not.toContain(base32Decode(secret));
    expect(row.backup_codes).not.toMatch(/^\[/);
  });
});

describe("sign-in with email + authenticator code, no password", () => {
  async function adminWithPasswordless() {
    const jar = new Jar();
    await signUp(EMAIL, jar);
    const secret = await enableTotp(jar);
    const toggled = await call("/api/auth/two-factor/passwordless", { enabled: true, password: PASSWORD }, jar);
    expect(toggled.status).toBe(200);
    return { jar, secret };
  }

  it("is refused until the account opts in, with the same error as an unknown email (A6)", async () => {
    const jar = new Jar();
    await signUp(EMAIL, jar);
    const secret = await enableTotp(jar);

    const notOptedIn = await call("/api/auth/sign-in/totp", { email: EMAIL, code: await totp(secret) });
    const unknown = await call("/api/auth/sign-in/totp", { email: "nobody@example.com", code: "123456" });

    expect(notOptedIn.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(notOptedIn.body!.message).toBe(INVALID_TOTP_SIGN_IN);
    expect(unknown.body!.message).toBe(INVALID_TOTP_SIGN_IN);
  });

  it("cannot be turned on without two-factor, or with a wrong password", async () => {
    const jar = new Jar();
    await signUp(EMAIL, jar);
    expect((await call("/api/auth/two-factor/passwordless", { enabled: true, password: PASSWORD }, jar)).status).toBe(400);
    await enableTotp(jar);
    expect((await call("/api/auth/two-factor/passwordless", { enabled: true, password: "nope-nope" }, jar)).status).toBe(400);
  });

  it("opens a session with the email and a valid code", async () => {
    const { secret } = await adminWithPasswordless();
    const jar = new Jar();

    const res = await call("/api/auth/sign-in/totp", { email: EMAIL, code: await totp(secret) }, jar);

    expect(res.status).toBe(200);
    expect(((await session(jar))!.user as Json).email).toBe(EMAIL);
  });

  it("refuses the same code twice (A7, replay)", async () => {
    const { secret } = await adminWithPasswordless();
    const code = await totp(secret);

    expect((await call("/api/auth/sign-in/totp", { email: EMAIL, code })).status).toBe(200);
    const replay = await call("/api/auth/sign-in/totp", { email: EMAIL, code });
    expect(replay.status).toBe(401);
    expect(replay.body!.message).toBe(INVALID_TOTP_SIGN_IN);
  });

  it("locks the account after 10 wrong codes, even for a right one (A7, lockout)", async () => {
    const { secret } = await adminWithPasswordless();
    const good = await totp(secret);
    const bad = good === "000000" ? "111111" : "000000";

    for (let i = 0; i < 10; i++) {
      expect((await call("/api/auth/sign-in/totp", { email: EMAIL, code: bad })).status).toBe(401);
    }
    expect((await call("/api/auth/sign-in/totp", { email: EMAIL, code: good })).status).toBe(429);
  });

  it("is turned off when two-factor is turned off (A8)", async () => {
    const { jar, secret } = await adminWithPasswordless();

    expect((await call("/api/auth/two-factor/disable", { password: PASSWORD }, jar)).status).toBe(200);

    const row = (await d1.prepare(`SELECT totp_passwordless FROM "user"`).first<{ totp_passwordless: number }>())!;
    expect(row.totp_passwordless).toBe(0);
    expect((await call("/api/auth/sign-in/totp", { email: EMAIL, code: await totp(secret) })).status).toBe(401);
  });
});
