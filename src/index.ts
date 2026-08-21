import { Hono } from "hono";
import { errorHandler } from "@/middleware/error.handler";
import { requestLoggerMiddleware } from "@/middleware/request-logger.middleware";
import { apiKeyMiddleware } from "@/middleware/api-key.middleware";
import { configMiddleware } from "@/middleware/config.middleware";
import { createSendEmailController, createSendEmailModule } from "@/send-email";
import type { SmtpConfig,UserConfig } from "./config/config";


export type Bindings = {
  AES_256_KEY: string;
  makisend_db: D1Database;
  PORT: number;
  BETTER_AUTH_SECRET:string;
  BETTER_AUTH_URL : string
};
export type UserInfoVariables = {
  userConfig : UserConfig
  smtpConfig: SmtpConfig;
};
const app = new Hono<{ Bindings: Bindings,Variables: UserInfoVariables }>();
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
  const smtpConfig = c.get("smtpConfig");
  const userConfig = c.get("userConfig")
  const { service } = createSendEmailModule(config,smtpConfig,userConfig);
  c.set("sendEmailService", service);
  await next();
});

app.route("/send-email", sendEmailController);

export default app;
