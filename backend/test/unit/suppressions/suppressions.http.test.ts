import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestD1, cleanupTestD1 } from "../../helpers/d1-setup";
import { app } from "@/index";
import type { Bindings } from "@/index";
import type { Suppression } from "@/suppressions";

const ORIGIN = "http://localhost:4321";

// deps.initDb() is a one-shot module singleton, so the whole file shares one D1.
let env: Bindings;
let mf: Parameters<typeof cleanupTestD1>[0];
let cookie = "";

const request = (path: string, init: RequestInit = {}, withCookie = true) =>
  app.request(
    path,
    {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Origin: ORIGIN,
        ...(withCookie ? { Cookie: cookie } : {}),
        ...(init.headers ?? {}),
      },
    },
    env,
  );

describe("Suppressions HTTP", () => {
  beforeAll(async () => {
    const testD1 = await createTestD1();
    mf = testD1.mf;
    env = {
      AES_256_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      makisend_db: testD1.d1,
      BETTER_AUTH_SECRET: "test-secret",
      BETTER_AUTH_URL: "http://localhost:8787",
      FRONTEND_URL: ORIGIN,
    } as unknown as Bindings;

    const res = await request(
      "/api/auth/sign-up/email",
      { method: "POST", body: JSON.stringify({ email: "owner@example.com", password: "password123" }) },
      false,
    );
    expect(res.status).toBe(200);
    const h = res.headers as Headers & { getSetCookie?: () => string[] };
    const cookies = h.getSetCookie ? h.getSetCookie() : [h.get("set-cookie")];
    cookie = cookies.map((c) => (c ?? "").split(";")[0]).join("; ");
  });

  afterAll(async () => {
    await cleanupTestD1(mf);
  });

  it("requires a session", async () => {
    expect((await request("/suppressions", {}, false)).status).toBe(401);
    expect((await request("/suppressions", { method: "POST", body: JSON.stringify({ email: "a@example.com" }) }, false)).status).toBe(401);
  });

  it("adds, lists and removes an address", async () => {
    const added = await request("/suppressions", {
      method: "POST",
      body: JSON.stringify({ email: "Unsub@Example.com", reason: "Asked to stop" }),
    });
    expect(added.status).toBe(201);
    expect(await added.json()).toEqual({ success: true, created: true });

    const again = await request("/suppressions", { method: "POST", body: JSON.stringify({ email: "unsub@example.com" }) });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ success: true, created: false });

    const listed = (await (await request("/suppressions")).json()) as { suppressions: Suppression[] };
    expect(listed.suppressions).toEqual([
      expect.objectContaining({ email: "unsub@example.com", source: "manual", reason: "Asked to stop", emailId: null }),
    ]);

    const id = listed.suppressions[0]!.id;
    expect((await request(`/suppressions/${id}`, { method: "DELETE" })).status).toBe(200);
    expect((await request(`/suppressions/${id}`, { method: "DELETE" })).status).toBe(404);
    expect(((await (await request("/suppressions")).json()) as { suppressions: Suppression[] }).suppressions).toEqual([]);
  });

  it("validates the payload", async () => {
    for (const body of [{ email: "not-an-email" }, { email: "a@example.com", reason: "line\nbreak" }, { email: "a@example.com", extra: 1 }]) {
      expect((await request("/suppressions", { method: "POST", body: JSON.stringify(body) })).status).toBe(400);
    }
  });
});
