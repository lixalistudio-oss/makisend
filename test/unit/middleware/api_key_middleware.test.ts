import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { apiKeyMiddleware } from "@/middleware/api-key.middleware";
import { errorHandler } from "@/middleware/error.handler";

const createApp = (apiKey: string) => {
  const app = new Hono();
  app.onError(errorHandler);
  app.use("/protected", apiKeyMiddleware(apiKey));
  app.get("/protected", (c) => c.json({ success: true }));
  return app;
};

describe("apiKeyMiddleware", () => {
  it("should allow request with valid x-api-key header", async () => {
    const app = createApp("valid-key");
    const res = await app.request("/protected", {
      headers: { "x-api-key": "valid-key" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });

  it("should allow request with valid Authorization Bearer header", async () => {
    const app = createApp("valid-key");
    const res = await app.request("/protected", {
      headers: { Authorization: "Bearer valid-key" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });

  it("should reject request without API key", async () => {
    const app = createApp("valid-key");
    const res = await app.request("/protected");
    expect(res.status).toBe(401);
  });

  it("should reject request with invalid API key", async () => {
    const app = createApp("valid-key");
    const res = await app.request("/protected", {
      headers: { "x-api-key": "wrong-key" },
    });
    expect(res.status).toBe(401);
  });

  it("should reject all requests when API key is empty", async () => {
    const app = createApp("");
    const res = await app.request("/protected", {
      headers: { "x-api-key": "" },
    });
    expect(res.status).toBe(401);
  });
});
