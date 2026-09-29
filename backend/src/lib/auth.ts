import { betterAuth } from "better-auth";
import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/db/schema";
import type { Bindings } from "@/index";

export function createAuth(env: Bindings) {
  const db = drizzle(env.makisend_db);

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema,
      transaction: false,
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [env.FRONTEND_URL].filter(Boolean),
    emailAndPassword: {
      enabled: true,
    },
    advanced: {
      // pages.dev and workers.dev are different sites: SameSite=Lax would make the
      // browser drop the session cookie on every cross-origin fetch.
      // SameSite=None is only accepted together with Secure.
      defaultCookieAttributes: {
        sameSite: "none",
        secure: true,
      },
    },
    plugins: [apiKey({ defaultPrefix: "mk_" })],
  });
}
