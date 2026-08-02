import { Hono } from "hono";
import { errorHandler } from "@/middleware/error.handler";
import { requestLoggerMiddleware } from "@/middleware/request-logger.middleware";
import { configMiddleware } from "@/middleware/config.middleware";
import { createSendEmailController } from "@/send-email";

export type Bindings = {
  AES_256_KEY: string;
  SMTP_USER: string;
  SMTP_PASSWORD: string;
  makisend_db: D1Database;
  SENDER_EMAIL: string;
  HOST: string;
  PORT: number;
  API_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use("*", requestLoggerMiddleware());
app.onError(errorHandler);
app.use(configMiddleware());

app.route("/send-email", createSendEmailController());

export default app;
