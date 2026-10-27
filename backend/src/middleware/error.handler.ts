import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError, EncryptionKeyError } from "@/core/errors";
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
        ...(error.code ? { code: error.code } : {}),
        ...(error instanceof EncryptionKeyError ? { variables: error.variables } : {}),
      },
      error.statusCode as ContentfulStatusCode,
    );
  }

  // Unexpected errors can carry SQL, binding names or stack details: log them, but
  // never send them to the caller.
  pinoLogger.error(
    { path: c.req.path, method: c.req.method, error: error.message },
    "Internal Server Error (Unhandled)",
  );

  return c.json({ success: false, error: "Internal Server Error" }, 500);
}
