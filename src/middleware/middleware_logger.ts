import { MiddlewareHandler } from "hono";
import { pinoLogger } from "../common/logger";

export const loggerMiddleware = (): MiddlewareHandler => {
  return async (c, next) => {
    // Collect the method and url (e.g., /send-email) of the incoming request
    const { method, url } = c.req;

    pinoLogger.info("New HTTP request incoming");

    // Start the stopwatch to track total request cycle duration
    const startTime = performance.now();
    
    // Wait until the downstream routes and middleware process and respond
    await next();

    // Gather response status and calculate the total duration in milliseconds
    const status = c.res.status;
    const durationMs = (performance.now() - startTime).toFixed(2);
    const logData = { method, url, status, durationMs };

    // Categorize log output severity based on the HTTP status code response
    if (status >= 500) {
      const nativeError = c.error;
      pinoLogger.error(
        { logData, error: nativeError },
        `HTTP Request Failed - Server Error: ${nativeError?.message || 'Unknown Error'}`
      );
    } else if (status >= 400) {
      const nativeError = c.error;
      pinoLogger.warn(
        { logData, error: nativeError },
        `HTTP Request Failed - Client Error: ${nativeError?.message || 'Unknown Error'}`
      );
    } else {
      pinoLogger.info(logData, 'HTTP Request Completed Successfully');
    }
  };
};
