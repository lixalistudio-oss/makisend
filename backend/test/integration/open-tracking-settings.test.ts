import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { app } from "@/index";
import type { Bindings } from "@/index";
import { createDatabase } from "@/db/connection";
import { emailLogs, user } from "@/db/schema";
import { generateTrackingToken } from "@/open-tracking";
import { encrypt } from "@/core/crypto";
import { cleanupTestD1, createTestD1 } from "../helpers/d1-setup";

const ORIGIN = "http://localhost:4321";
const AES_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

// deps.initDb() is a one-shot module singleton, so the whole file shares one D1 and one account.
let env: Bindings;
let mf: Parameters<typeof cleanupTestD1>[0];
let d1: D1Database;
let cookie = "";
let userId = "";

const call = (path: string, init: RequestInit = {}) =>
  app.request(
    path,
    {
      ...init,
      headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: cookie, ...init.headers },
    },
    env,
  );

async function sessionUser(): Promise<{ id: string; openTrackingEnabled?: boolean }> {
  const res = await call("/api/auth/get-session");
  expect(res.status).toBe(200);
  return ((await res.json()) as { user: { id: string; openTrackingEnabled?: boolean } }).user;
}

beforeAll(async () => {
  const testD1 = await createTestD1();
  mf = testD1.mf;
  d1 = testD1.d1;
  env = {
    AES_256_KEY: AES_KEY,
    makisend_db: d1,
    BETTER_AUTH_SECRET: "test-secret-open-tracking-settings",
    BETTER_AUTH_URL: "http://localhost:8787",
    FRONTEND_URL: ORIGIN,
  } as unknown as Bindings;

  const res = await call("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email: "owner@example.com", password: "password123" }),
  });
  expect(res.status).toBe(200);
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  const cookies = headers.getSetCookie ? headers.getSetCookie() : [headers.get("set-cookie")];
  cookie = cookies.map((c) => (c ?? "").split(";")[0]).join("; ");
  userId = (await sessionUser()).id;
});

afterAll(async () => {
  await cleanupTestD1(mf);
});

describe("account open tracking setting (Better Auth user field)", () => {
  it("is off for a new account, and the session says so", async () => {
    expect((await sessionUser()).openTrackingEnabled).toBe(false);
  });

  it("is turned on and off with update-user, and lands in user.open_tracking_enabled", async () => {
    const column = async () =>
      (
        await createDatabase(d1)
          .select({ enabled: user.openTrackingEnabled })
          .from(user)
          .where(eq(user.id, userId))
      )[0].enabled;

    const on = await call("/api/auth/update-user", {
      method: "POST",
      body: JSON.stringify({ openTrackingEnabled: true }),
    });
    expect(on.status).toBe(200);
    expect((await sessionUser()).openTrackingEnabled).toBe(true);
    expect(await column()).toBe(true);

    const off = await call("/api/auth/update-user", {
      method: "POST",
      body: JSON.stringify({ openTrackingEnabled: false }),
    });
    expect(off.status).toBe(200);
    expect((await sessionUser()).openTrackingEnabled).toBe(false);
    expect(await column()).toBe(false);
  });

  it("cannot be changed without a session", async () => {
    const res = await app.request(
      "/api/auth/update-user",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGIN },
        body: JSON.stringify({ openTrackingEnabled: true }),
      },
      env,
    );
    expect(res.status).toBe(401);
  });
});

describe("email logs expose the open tracking fields, never the token", () => {
  it("returns trackingEnabled, the open dates and the count in the list and the detail", async () => {
    const token = generateTrackingToken();
    const internalId = crypto.randomUUID();
    await createDatabase(d1).insert(emailLogs).values({
      internalId,
      userId,
      to: await encrypt("recipient@example.com", AES_KEY),
      subject: "Tracked",
      trackingEnabled: true,
      trackingToken: token,
      firstOpenedAt: "2026-11-19T10:00:00.000Z",
      lastOpenedAt: "2026-11-19T10:05:00.000Z",
      openCount: 3,
    });

    const expected = {
      trackingEnabled: true,
      firstOpenedAt: "2026-11-19T10:00:00.000Z",
      lastOpenedAt: "2026-11-19T10:05:00.000Z",
      openCount: 3,
    };

    const detail = await call(`/email-logs/${internalId}`);
    expect(detail.status).toBe(200);
    const detailText = await detail.text();
    expect(JSON.parse(detailText).log).toMatchObject({ ...expected, to: "recipient@example.com" });
    expect(detailText).not.toContain(token);
    expect(detailText).not.toContain("trackingToken");

    const list = await call("/email-logs");
    expect(list.status).toBe(200);
    const listText = await list.text();
    expect(JSON.parse(listText).logs).toEqual([expect.objectContaining(expected)]);
    expect(listText).not.toContain(token);
    expect(listText).not.toContain("trackingToken");
  });
});
