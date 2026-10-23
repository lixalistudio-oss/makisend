/**
 * ── Failure analysis (written before the code) ──
 *  E1  An unexpected error (D1, a binding, a library) is answered with its own message:
 *      SQL, table or binding names reach the caller.
 *  E2  Masking it also masks an AppError, whose message is written for the caller.
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { AppError } from "@/core/errors";
import { errorHandler } from "@/middleware/error.handler";

function appThrowing(error: Error) {
  const app = new Hono();
  app.get("/", () => {
    throw error;
  });
  app.onError(errorHandler);
  return app;
}

describe("errorHandler", () => {
  it("E1 never sends an unexpected error's message", async () => {
    const res = await appThrowing(new Error("D1_ERROR: no such table: smtp_config: SQLITE_ERROR")).request("/");
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).not.toMatch(/smtp_config|SQLITE|D1_ERROR/);
    expect(JSON.parse(body)).toEqual({ success: false, error: "Internal Server Error" });
  });

  it("E2 keeps an AppError's status and message", async () => {
    const res = await appThrowing(new AppError(409, "SMTP configuration is inactive")).request("/");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ success: false, error: "SMTP configuration is inactive" });
  });
});
