import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { twoFactor } from "better-auth/plugins/two-factor";
import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { Bindings } from "@/index";
import { claimOwnership, releaseOwnership, SETUP_COMPLETE_MESSAGE } from "@/lib/owner-lock";
import { totpSignIn } from "@/lib/totp-sign-in";

/** Name shown in authenticator apps next to the account ("MakiSend (admin@example.com)"). */
export const TOTP_ISSUER = "MakiSend";

/**
 * API key plugin options. There is no per-key sending quota: Better Auth would
 * otherwise stamp every key with 10 requests per day and refuse the rest with a 403.
 * `enabled: false` is checked before the quota stamped on the key itself, so it also
 * covers keys created while a limit was in place, with no data migration.
 */
export const apiKeyOptions = {
  defaultPrefix: "mk_",
  rateLimit: { enabled: false },
};

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
    trustedOrigins: env.FRONTEND_URL ? [env.FRONTEND_URL] : [],
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
        // The instance is set up again at the next connection (src/lib/owner-lock.ts).
        afterDelete: async () => {
          await releaseOwnership(env.makisend_db);
        },
      },
    },
    // One account per instance: its super admin, created at the first connection. The check is
    // on account creation itself, so every creation path is covered, not only /sign-up/email.
    databaseHooks: {
      user: {
        create: {
          before: async () => {
            if (!(await claimOwnership(env.makisend_db))) {
              throw APIError.from("FORBIDDEN", { message: SETUP_COMPLETE_MESSAGE, code: "SETUP_COMPLETE" });
            }
          },
        },
      },
    },
    // Better Auth only turns its rate limiter on when NODE_ENV=production, which Workers
    // never sets: without this block sign-in could be brute-forced without limit.
    // - database storage: in-memory counters live per isolate, so they limit nothing here;
    // - cf-connecting-ip: Cloudflare sets it and strips client-supplied values, unlike
    //   x-forwarded-for (Better Auth's default), which Cloudflare does not provide.
    rateLimit: {
      enabled: env.RATE_LIMIT !== "off",
      storage: "database",
      window: 60,
      max: 100,
    },
    advanced: {
      ipAddress: {
        ipAddressHeaders: ["cf-connecting-ip"],
      },
      // pages.dev and workers.dev are different sites: SameSite=Lax would make the
      // browser drop the session cookie on every cross-origin fetch.
      // SameSite=None is only accepted together with Secure.
      defaultCookieAttributes: {
        sameSite: "none",
        secure: true,
      },
    },
    plugins: [
      apiKey(apiKeyOptions),
      // TOTP (Google Authenticator, 1Password, ...): turned on from Settings. Secret and backup
      // codes are encrypted with BETTER_AUTH_SECRET by Better Auth, not with ENCRYPTION_KEY: the
      // key-rotation job does not touch them (see AGENTS.md, "Two-factor authentication").
      twoFactor({
        issuer: TOTP_ISSUER,
        backupCodeOptions: { storeBackupCodes: "encrypted" },
      }),
      totpSignIn(),
    ],
  });
}
