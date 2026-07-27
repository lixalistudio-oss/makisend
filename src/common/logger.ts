import { pino } from "pino";

/**
 * Custom logging destination for edge environments (e.g., Cloudflare Workers).
 * Routes Pino output directly to the console to avoid Node.js-specific 
 * features (like worker_threads or fs) that are incompatible with Wrangler.
 */
const edgeDestination = {
  write: (message: string) => {
    console.log(message);
  },
};

/**
 * Pino logger instance configured for edge environments.
 * 
 * Note: The `transport` option is intentionally omitted. Transports like 
 * `pino-pretty` or `pino/file` rely on unsupported Node.js APIs and will 
 * cause Wrangler to crash.
 */
export const pinoLogger = pino(
  {
    level: "info",
  },
  edgeDestination
);