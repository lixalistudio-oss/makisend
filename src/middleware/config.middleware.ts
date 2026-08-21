import { createMiddleware } from "hono/factory";
import { createConfig, type Config, type SmtpConfig } from "@/config/config";

declare module "hono" {
  interface ContextVariableMap {
    appConfig: Config;
    smtpConfig: SmtpConfig;
  }
}

export function configMiddleware() {
  return createMiddleware(async (c, next) => {
    const config = createConfig(c.env);
    c.set("appConfig", config);

    // Build smtpConfig from env
    const smtpConfig: SmtpConfig = {
      smtpHostName: c.env.HOST,
      senderEmail: c.env.SENDER_EMAIL,
      smtpUsername: c.env.SMTP_USER,
      smtpPassword: c.env.SMTP_PASSWORD,
    };
    c.set("smtpConfig", smtpConfig);

    await next();
  });
}
