import { betterAuth } from "better-auth";
import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
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
    user: {
      // Lets the settings page POST /api/auth/change-email { newEmail }.
      // sign-up leaves emailVerified=false and no verification flow is
      // configured, so updateEmailWithoutVerification applies: the email is
      // changed immediately instead of requiring a confirmation link.
      changeEmail: {
        enabled: true,
        updateEmailWithoutVerification: true,
      },
      deleteUser: {
        enabled: true,
        // email_logs has no foreign key to user (it points at apikey), so the
        // ON DELETE cascade from user -> smtp_config -> apikey would be blocked
        // by surviving log rows. Purge them before Better Auth deletes the user.
        beforeDelete: async (deletedUser) => {
          await db.delete(schema.emailLogs).where(eq(schema.emailLogs.userId, deletedUser.id));
        },
      },
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
    plugins: [
      apiKey({
        defaultPrefix: "mk_",
        // Better-auth defaults to 10 requests per key per day — far too low for
        // an email API (and it fails with 403, not 429). Keys are stamped with
        // this value at creation time.
        rateLimit: {
          enabled: true,
          maxRequests: 10000,
          timeWindow: 1000 * 60 * 60 * 24,
        },
      }),
    ],
  });
}
