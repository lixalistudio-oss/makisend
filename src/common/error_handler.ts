import { AppError } from "../middleware/errors/app_error";
import { Context } from "hono";
import { pinoLogger } from "../common/logger"; // Ensure your logger is imported

/**
 * Global centralized error handler for catching and standardizing application exceptions.
 */
export function error_handler(error: Error, c: Context) {
  // Handle explicit custom application errors
  if (error instanceof AppError) {
    // Log it so you have a record in your structured logs
    pinoLogger.error(
      { status: error.statusCode, path: c.req.path, method: c.req.method },
      `AppError: ${error.message}`
    );

    return c.json({
      success: false,
      error: error.message
    }, error.statusCode as any); // 
  }

  // Fallback structural safety log for unhandled runtime exceptions
  pinoLogger.error(
    { path: c.req.path, method: c.req.method, error: error.message },
    "Internal Server Error (Unhandled)"
  );
  
  return c.json({
    success: false,
    error: error.message || "Internal Server Error"
  }, 500); // This one was already correct!
}