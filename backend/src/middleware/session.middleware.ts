import { createMiddleware } from "hono/factory";


declare module "hono" {
  interface ContextVariableMap {
    userId: string;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sessionMiddleware(_auth: any) {
  return createMiddleware(async (c, next) => {
    await next();
  });
}
