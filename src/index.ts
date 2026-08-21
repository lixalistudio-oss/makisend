import { Hono } from "hono";
import { errorHandler } from "@/middleware/error.handler";
import { requestLoggerMiddleware } from "@/middleware/request-logger.middleware";
import { apiKeyMiddleware } from "@/middleware/api-key.middleware";
import { configMiddleware } from "@/middleware/config.middleware";
import { createSendEmailController, createSendEmailModule } from "@/send-email";
import { createAuth } from "@/lib/auth";
import type { SmtpConfig, UserConfig } from "./config/config";

export type Bindings = {
  AES_256_KEY: string;
  makisend_db: D1Database;
  PORT: number;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
};

export type UserInfoVariables = {
  userConfig: UserConfig;
  smtpConfig: SmtpConfig;
};

const app = new Hono<{ Bindings: Bindings; Variables: UserInfoVariables }>();

// Singleton: auth created once on first request, reused after
let authInstance: ReturnType<typeof createAuth> | null = null;

function getAuthInstance(env: Bindings) {
  if (!authInstance) {
    authInstance = createAuth(env);
  }
  return authInstance;
}

app.use("*", requestLoggerMiddleware());
app.onError(errorHandler);
app.use(configMiddleware());

app.use("/send-email/*", async (c, next) => {
  const config = c.get("appConfig");
  const auth = getAuthInstance(c.env);
  await apiKeyMiddleware(config, auth)(c, next);
});

app.use("/send-email/*", async (c, next) => {
  const config = c.get("appConfig");
  const smtpConfig = c.get("smtpConfig");
  const userConfig = c.get("userConfig");
  const { service } = createSendEmailModule(config, smtpConfig, userConfig);
  c.set("sendEmailService", service);
  await next();
});

const sendEmailController = createSendEmailController();
app.route("/send-email", sendEmailController);

export default app;
