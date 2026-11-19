import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { app } from "@/index";
import type { Bindings } from "@/index";
import { createDatabase } from "@/db/connection";
import { emailLogs } from "@/db/schema";
import { pinoLogger } from "@/core/logger";
import {
  generateTrackingToken,
  OPEN_WRITE_THROTTLE_MS,
  OpenTrackingRepository,
  TRANSPARENT_GIF,
} from "@/open-tracking";
import { cleanupTestD1, createTestD1 } from "../helpers/d1-setup";

let mf: Parameters<typeof cleanupTestD1>[0];
let d1: D1Database;
let env: Bindings;

beforeAll(async () => {
  const testD1 = await createTestD1();
  mf = testD1.mf;
  d1 = testD1.d1;
  env = {
    AES_256_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    makisend_db: d1,
    BETTER_AUTH_SECRET: "test-secret-for-open-tracking",
    BETTER_AUTH_URL: "https://api.example.com",
  } as unknown as Bindings;
});

afterAll(async () => {
  await cleanupTestD1(mf);
});

beforeEach(async () => {
  await createDatabase(d1).delete(emailLogs);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Inserts an email log row; tracked rows get a fresh token. */
async function insertEmail(options: { tracked: boolean; token?: string | null }) {
  const internalId = crypto.randomUUID();
  const trackingToken = options.token !== undefined ? options.token : options.tracked ? generateTrackingToken() : null;
  await createDatabase(d1).insert(emailLogs).values({
    internalId,
    userId: "user-1",
    to: "encrypted-recipient",
    subject: "Hello",
    trackingEnabled: options.tracked,
    trackingToken,
  });
  return { internalId, trackingToken: trackingToken as string };
}

async function readRow(internalId: string) {
  const [row] = await createDatabase(d1)
    .select({
      openCount: emailLogs.openCount,
      firstOpenedAt: emailLogs.firstOpenedAt,
      lastOpenedAt: emailLogs.lastOpenedAt,
    })
    .from(emailLogs)
    .where(eq(emailLogs.internalId, internalId));
  return row;
}

describe("OpenTrackingRepository.recordOpen (real D1)", () => {
  const t0 = new Date("2026-11-19T10:00:00.000Z");
  const at = (ms: number) => new Date(t0.getTime() + ms);

  it("records the first open: count 1, first and last open at the same instant", async () => {
    const email = await insertEmail({ tracked: true });
    const repository = new OpenTrackingRepository(createDatabase(d1));

    expect(await repository.recordOpen(email.trackingToken, t0)).toBe(true);
    expect(await readRow(email.internalId)).toEqual({
      openCount: 1,
      firstOpenedAt: t0.toISOString(),
      lastOpenedAt: t0.toISOString(),
    });
  });

  it("ignores opens less than 30 seconds after the last one, and counts the one at exactly 30 seconds", async () => {
    const email = await insertEmail({ tracked: true });
    const repository = new OpenTrackingRepository(createDatabase(d1));

    await repository.recordOpen(email.trackingToken, t0);
    expect(await repository.recordOpen(email.trackingToken, at(1))).toBe(false);
    expect(await repository.recordOpen(email.trackingToken, at(OPEN_WRITE_THROTTLE_MS - 1))).toBe(false);
    expect((await readRow(email.internalId)).openCount).toBe(1);

    expect(await repository.recordOpen(email.trackingToken, at(OPEN_WRITE_THROTTLE_MS))).toBe(true);
    expect(await readRow(email.internalId)).toEqual({
      openCount: 2,
      firstOpenedAt: t0.toISOString(),
      lastOpenedAt: at(OPEN_WRITE_THROTTLE_MS).toISOString(),
    });
  });

  it("measures the window from the last recorded open, not from the first", async () => {
    const email = await insertEmail({ tracked: true });
    const repository = new OpenTrackingRepository(createDatabase(d1));

    await repository.recordOpen(email.trackingToken, t0);
    await repository.recordOpen(email.trackingToken, at(30_000));
    expect(await repository.recordOpen(email.trackingToken, at(45_000))).toBe(false);
    expect(await repository.recordOpen(email.trackingToken, at(60_000))).toBe(true);
    expect((await readRow(email.internalId)).openCount).toBe(3);
  });

  it("counts two simultaneous opens once", async () => {
    const email = await insertEmail({ tracked: true });
    const repository = new OpenTrackingRepository(createDatabase(d1));

    const results = await Promise.all([
      repository.recordOpen(email.trackingToken, t0),
      repository.recordOpen(email.trackingToken, t0),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await readRow(email.internalId)).openCount).toBe(1);
  });

  it("only touches the email that carries the token", async () => {
    const opened = await insertEmail({ tracked: true });
    const other = await insertEmail({ tracked: true });
    const repository = new OpenTrackingRepository(createDatabase(d1));

    await repository.recordOpen(opened.trackingToken, t0);

    expect((await readRow(other.internalId)).openCount).toBe(0);
    expect((await readRow(other.internalId)).firstOpenedAt).toBeNull();
  });

  it("returns false for an unknown token", async () => {
    await insertEmail({ tracked: true });
    const repository = new OpenTrackingRepository(createDatabase(d1));

    expect(await repository.recordOpen(generateTrackingToken(), t0)).toBe(false);
  });

  it("never counts an email whose tracking is off, even if a token is somehow present", async () => {
    const email = await insertEmail({ tracked: false, token: generateTrackingToken() });
    const repository = new OpenTrackingRepository(createDatabase(d1));

    expect(await repository.recordOpen(email.trackingToken, t0)).toBe(false);
    expect((await readRow(email.internalId)).openCount).toBe(0);
  });
});

describe("GET /t/o/:token through the real app", () => {
  const pixel = (token: string, init?: RequestInit) =>
    app.request(`https://api.example.com/t/o/${token}`, init, env);

  it("is public: no API key, no session, and it answers the GIF", async () => {
    const email = await insertEmail({ tracked: true });

    const res = await pixel(email.trackingToken);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/gif");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(TRANSPARENT_GIF);
    expect((await readRow(email.internalId)).openCount).toBe(1);
  });

  it("applies the 30-second limit per email over HTTP", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-19T10:00:00.000Z"));
    const email = await insertEmail({ tracked: true });

    await pixel(email.trackingToken);
    vi.setSystemTime(new Date("2026-11-19T10:00:29.999Z"));
    const throttled = await pixel(email.trackingToken);
    expect(throttled.status).toBe(200);
    expect((await readRow(email.internalId)).openCount).toBe(1);

    vi.setSystemTime(new Date("2026-11-19T10:00:30.000Z"));
    await pixel(email.trackingToken);
    expect(await readRow(email.internalId)).toEqual({
      openCount: 2,
      firstOpenedAt: "2026-11-19T10:00:00.000Z",
      lastOpenedAt: "2026-11-19T10:00:30.000Z",
    });
  });

  it("answers the same GIF for an unknown or malformed token", async () => {
    for (const token of [generateTrackingToken(), "not-a-token"]) {
      const res = await pixel(token);
      expect(res.status).toBe(200);
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(TRANSPARENT_GIF);
    }
  });

  it("never writes the token to the request log", async () => {
    const info = vi.spyOn(pinoLogger, "info");
    const email = await insertEmail({ tracked: true });

    await pixel(email.trackingToken);

    const logged = JSON.stringify(info.mock.calls);
    expect(logged).toContain("/t/o/[redacted]");
    expect(logged).not.toContain(email.trackingToken);
  });
});
