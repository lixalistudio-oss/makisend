import { createMiddleware } from "hono/factory";
import { AppError } from "@/core/errors";

declare module "hono" {
  interface ContextVariableMap {
    userId: string;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sessionMiddleware(auth: any) {
  return createMiddleware(async (c, next) => {66666});
}
