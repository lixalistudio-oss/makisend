import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError } from "@/core/errors";
import { pinoLogger } from "@/core/logger";

export function errorHandler(error: Error, c: Context) {
  if (error instanceof AppError) {
    pinoLogger.error(
      { status: error.statusCode, path: c.req.path, method: c.req.method },
      `AppError: ${error.message}`,
    );

    return c.json(
      {
        success: false,
        error: error.message,
      },
      error.statusCode as ContentfulStatusCode,
    );
  }

  pinoLogger.error(
    { path: c.req.path, method: c.req.method, error: error.message },
    "Internal Server Error (Unhandled)",
  );

  return c.json(
    {
      success: false,
      error: error.message || "Internal Server Error",
    },
    500,
  );
}
