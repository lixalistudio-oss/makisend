import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import {
  createOpenTrackingController,
  TRACKING_PIXEL_ROUTE,
  TRANSPARENT_GIF,
  type IOpenTrackingRepository,
} from "@/open-tracking";

const TOKEN = "AbCdEf0123456789".padEnd(43, "Q");

function buildApp() {
  const recordOpen = vi.fn<IOpenTrackingRepository["recordOpen"]>().mockResolvedValue(true);
  const app = new Hono();
  app.route(TRACKING_PIXEL_ROUTE, createOpenTrackingController(() => ({ recordOpen })));
  return { app, recordOpen };
}

async function expectPixel(res: Response) {
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("image/gif");
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  expect(res.headers.get("Content-Length")).toBe(String(TRANSPARENT_GIF.byteLength));
  expect(new Uint8Array(await res.arrayBuffer())).toEqual(TRANSPARENT_GIF);
}

describe("GET /t/o/:token", () => {
  let app: Hono;
  let recordOpen: ReturnType<typeof buildApp>["recordOpen"];

  beforeEach(() => {
    ({ app, recordOpen } = buildApp());
  });

  it("records the open of a well-formed token and answers the GIF", async () => {
    const before = Date.now();
    const res = await app.request(`/t/o/${TOKEN}`);

    await expectPixel(res);
    expect(recordOpen).toHaveBeenCalledTimes(1);
    const [token, now] = recordOpen.mock.calls[0];
    expect(token).toBe(TOKEN);
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("answers the same GIF for an unknown or throttled token", async () => {
    recordOpen.mockResolvedValue(false);

    await expectPixel(await app.request(`/t/o/${TOKEN}`));
  });

  it.each([
    ["too short", "abc"],
    ["wrong alphabet", `${"a".repeat(42)}-`],
    ["too long", "a".repeat(200)],
  ])("never touches the database for a malformed token (%s), and still answers the GIF", async (_label, token) => {
    await expectPixel(await app.request(`/t/o/${token}`));
    expect(recordOpen).not.toHaveBeenCalled();
  });

  it("still answers the GIF when the database fails", async () => {
    recordOpen.mockRejectedValue(new Error("D1 unavailable"));

    await expectPixel(await app.request(`/t/o/${TOKEN}`));
  });

  it("does not count a HEAD request as an open", async () => {
    const res = await app.request(`/t/o/${TOKEN}`, { method: "HEAD" });

    expect(res.status).toBe(200);
    expect(recordOpen).not.toHaveBeenCalled();
  });

  it("only answers GET: other methods are not routes", async () => {
    const res = await app.request(`/t/o/${TOKEN}`, { method: "POST" });

    expect(res.status).toBe(404);
    expect(recordOpen).not.toHaveBeenCalled();
  });
});
