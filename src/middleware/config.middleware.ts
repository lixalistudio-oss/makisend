import { createMiddleware } from "hono/factory";
import { createConfig, type Config, type SmtpConfig, type UserConfig } from "@/config/config";

declare module "hono" {
  interface ContextVariableMap {
    appConfig: Config;
    smtpConfig: SmtpConfig;
    userConfig: UserConfig;
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

    // userConfig - for now use a default, later get from auth
    const userConfig: UserConfig = {
      userId: c.env.USER_ID ?? "default-user",
    };
    c.set("userConfig", userConfig);

    await next();
  });
}
