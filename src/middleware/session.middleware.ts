import { createMiddleware } from "hono/factory";
import { AppError } from "@/core/errors";

declare module "hono" {
  interface ContextVariableMap {
    userId: string;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sessionMiddleware(auth: any) {
  return createMiddleware(async (c, next) => {
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session || !session.user) {
      throw new AppError(401, "Unauthorized: invalid or missing session");
    }

    c.set("userId", session.user.id);

    await next();
  });
}
