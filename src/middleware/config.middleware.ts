import { createMiddleware } from "hono/factory";
import { createConfig, type Config } from "@/config/config";

declare module "hono" {
  interface ContextVariableMap {
    appConfig: Config;
  }
}

export function configMiddleware() {
  return createMiddleware(async (c, next) => {
    c.set("appConfig", createConfig(c.env));
    await next();
  });
}
