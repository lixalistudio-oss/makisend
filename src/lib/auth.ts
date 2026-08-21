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
    plugins: [apiKey({ defaultPrefix: "mk_" })],
  });
}
