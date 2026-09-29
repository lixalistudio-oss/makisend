import { createMiddleware } from "hono/factory";
import { pinoLogger } from "@/core/logger";
import { AppError } from "@/core/errors";

declare module "hono" {
  interface ContextVariableMap {
    userId: string;
  }
}

// Resolves the Better Auth session from the request cookie and exposes the
// authenticated user id to controllers through c.get("userId"). Without this,
// every protected route runs with userId === undefined and inserts fail on the
// NOT NULL columns of the user-owned tables.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sessionMiddleware(auth: any) {
  return createMiddleware(async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    if (!session?.user?.id) {
      pinoLogger.error("No valid session");
      throw new AppError(401, "Unauthorized");
    }

    c.set("userId", session.user.id);
    await next();
  });
}
