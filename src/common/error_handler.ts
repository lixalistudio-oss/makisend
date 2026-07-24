import { AppError } from "../middleware/errors/app_error";
import { Context } from "hono";


/**
 * Global centralized error handler for catching and standardizing application exceptions.
 */
export function error_handler(error: Error, c: Context) {
  // Handle explicit custom application errors
  if (error instanceof AppError) {
    return c.json({
      success: false,
      error: error.message
    }); // Dynamic status evaluation matching AppError definition
  }

  // Fallback structural safety log for unhandled runtime exceptions
  console.error('Internal Server Error:', error);
  
  return c.json({
    success: false,
    error: error.message
  }, 500);
}
