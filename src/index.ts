import { Hono } from "hono";
import { errorHandler } from "@/middleware/error.handler";
import { requestLoggerMiddleware } from "@/middleware/request-logger.middleware";
import { apiKeyMiddleware } from "@/middleware/api-key.middleware";
import { configMiddleware } from "@/middleware/config.middleware";
import { createSendEmailController, createSendEmailModule } from "@/send-email";

export type Bindings = {
  AES_256_KEY: string;
  SMTP_USER: string;
  SMTP_PASSWORD: string;
  makisend_db: D1Database;
  SENDER_EMAIL: string;
  HOST: string;
  PORT: number;
  API_KEY: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL : string
};

const app = new Hono<{ Bindings: Bindings }>();
const sendEmailController = createSendEmailController();

app.use("*", requestLoggerMiddleware());
app.onError(errorHandler);
app.use(configMiddleware());

app.use("/send-email/*", async (c, next) => {
  const config = c.get("appConfig");
  await apiKeyMiddleware(config)(c, next);
});

app.use("/send-email/*", async (c, next) => {
  const config = c.get("appConfig");
  const { service } = createSendEmailModule(config);
  c.set("sendEmailService", service);
  await next();
});

app.route("/send-email", sendEmailController);

export default app;
