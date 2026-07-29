import { createMiddleware } from "hono/factory";
import { pinoLogger } from "@/core/logger";

export function requestLoggerMiddleware() {
  return createMiddleware(async (c, next) => {
    const method = c.req.method;
    const url = c.req.url;

    pinoLogger.info({ method, url }, "New HTTP request incoming");

    const startTime = performance.now();

    try {
      await next();
    } catch (err) {
      pinoLogger.error(
        { method, url, error: err },
        "HTTP Request Failed - Unhandled Error",
      );
      throw err;
    }

    const status = c.res.status;
    const durationMs = (performance.now() - startTime).toFixed(2);
    const logData = { method, url, status, durationMs };

    if (status >= 500) {
      pinoLogger.error(
        logData,
        `HTTP Request Failed - Server Error: ${c.res.statusText || "Unknown Error"}`,
      );
    } else if (status >= 400) {
      pinoLogger.warn(
        logData,
        `HTTP Request Failed - Client Error: ${c.res.statusText || "Unknown Error"}`,
      );
    } else {
      pinoLogger.info(logData, "HTTP Request Completed Successfully");
    }
  });
}
