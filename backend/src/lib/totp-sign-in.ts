import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, createAuthMiddleware, sensitiveSessionMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { symmetricDecrypt } from "better-auth/crypto";
import { createOTP } from "@better-auth/utils/otp";
import * as z from "zod";

/**
 * Sign in with email + authenticator code, no password ("passwordless TOTP").
 *
 * Opt-in per account, from Settings, once two-factor authentication is on: the password is asked
 * to turn it on or off. Off by default, because a TOTP code alone is one factor (something you
 * have) instead of two.
 *
 * Defences, all server-side:
 * - one generic error for an unknown address, an account without the option and a wrong code,
 *   so the endpoint does not reveal which addresses exist;
 * - the code is accepted once: a replayed code (same account, inside its validity window) fails;
 * - wrong codes count toward the two-factor plugin's account lockout (10 failures = 15 min lock),
 *   on the same columns as the second-factor check;
 * - `/sign-in/*` falls under Better Auth's strict limit (3 attempts per 10 s per IP).
 */

export const TOTP_SIGN_IN_PATH = "/sign-in/totp";
export const PASSWORDLESS_TOGGLE_PATH = "/two-factor/passwordless";
export const INVALID_TOTP_SIGN_IN = "Invalid email or authenticator code";

const TOTP_PERIOD_SECONDS = 30;
/** createOTP().verify accepts the previous, current and next period (window 1). */
const CODE_LIFETIME_MS = 3 * TOTP_PERIOD_SECONDS * 1000;
const MAX_FAILED_ATTEMPTS = 10;
const LOCK_MS = 15 * 60 * 1000;

interface TwoFactorRow {
  id: string;
  secret: string;
  userId: string;
  verified?: boolean | null;
  failedVerificationCount?: number | null;
  lockedUntil?: Date | string | number | null;
}

interface PasswordlessUser {
  id: string;
  email: string;
  twoFactorEnabled?: boolean | null;
  totpPasswordless?: boolean | null;
}

const signInBody = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/),
  rememberMe: z.boolean().optional(),
});

const toggleBody = z.object({
  enabled: z.boolean(),
  password: z.string().min(1),
});

export function totpSignIn(): BetterAuthPlugin {
  return {
    id: "totp-sign-in",
    schema: {
      user: {
        fields: {
          totpPasswordless: { type: "boolean", required: false, defaultValue: false, input: false },
        },
      },
    },
    endpoints: {
      signInTotp: createAuthEndpoint(
        TOTP_SIGN_IN_PATH,
        { method: "POST", body: signInBody },
        async (ctx) => {
          const invalid = () => APIError.from("UNAUTHORIZED", { message: INVALID_TOTP_SIGN_IN, code: "INVALID_TOTP_SIGN_IN" });

          const found = await ctx.context.internalAdapter.findUserByEmail(ctx.body.email);
          const user = found?.user as PasswordlessUser | undefined;
          if (!user?.twoFactorEnabled || !user.totpPasswordless) throw invalid();

          const twoFactor = (await ctx.context.adapter.findOne({
            model: "twoFactor",
            where: [{ field: "userId", value: user.id }],
          })) as TwoFactorRow | null;
          if (!twoFactor || twoFactor.verified === false) throw invalid();

          if (twoFactor.lockedUntil && new Date(twoFactor.lockedUntil).getTime() > Date.now()) {
            throw APIError.from("TOO_MANY_REQUESTS", {
              message: "Too many failed attempts. Try again later.",
              code: "ACCOUNT_TEMPORARILY_LOCKED",
            });
          }

          const secret = await symmetricDecrypt({ key: ctx.context.secretConfig, data: twoFactor.secret });
          const valid = await createOTP(secret, { digits: 6, period: TOTP_PERIOD_SECONDS }).verify(ctx.body.code);

          if (!valid) {
            const failures = (twoFactor.failedVerificationCount ?? 0) + 1;
            await ctx.context.adapter.update({
              model: "twoFactor",
              where: [{ field: "id", value: twoFactor.id }],
              update: {
                failedVerificationCount: failures >= MAX_FAILED_ATTEMPTS ? 0 : failures,
                ...(failures >= MAX_FAILED_ATTEMPTS ? { lockedUntil: new Date(Date.now() + LOCK_MS) } : {}),
              },
            });
            throw invalid();
          }

          // One use per code: the verification row outlives the code's validity window.
          const replayKey = `totp-sign-in-${user.id}-${ctx.body.code}`;
          const used = await ctx.context.internalAdapter.findVerificationValue(replayKey);
          if (used && new Date(used.expiresAt).getTime() > Date.now()) throw invalid();
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: replayKey,
            value: user.id,
            expiresAt: new Date(Date.now() + CODE_LIFETIME_MS),
          });

          await ctx.context.adapter.update({
            model: "twoFactor",
            where: [{ field: "id", value: twoFactor.id }],
            update: { failedVerificationCount: 0, lockedUntil: null },
          });

          const rememberMe = ctx.body.rememberMe !== false;
          const session = await ctx.context.internalAdapter.createSession(user.id, !rememberMe);
          if (!session) throw APIError.from("INTERNAL_SERVER_ERROR", { message: "Failed to create session", code: "FAILED_TO_CREATE_SESSION" });
          await setSessionCookie(ctx, { session, user: found!.user }, !rememberMe);
          return ctx.json({ token: session.token, user: { id: user.id, email: user.email } });
        },
      ),
      setTotpPasswordless: createAuthEndpoint(
        PASSWORDLESS_TOGGLE_PATH,
        { method: "POST", body: toggleBody, use: [sensitiveSessionMiddleware] },
        async (ctx) => {
          const user = ctx.context.session.user as PasswordlessUser;
          const account = await ctx.context.internalAdapter.findCredentialAccount(user.id);
          const passwordOk = !!account?.password && (await ctx.context.password.verify({ hash: account.password, password: ctx.body.password }));
          if (!passwordOk) throw APIError.from("BAD_REQUEST", { message: "Invalid password", code: "INVALID_PASSWORD" });
          if (ctx.body.enabled && !user.twoFactorEnabled) {
            throw APIError.from("BAD_REQUEST", {
              message: "Turn on two-factor authentication first",
              code: "TWO_FACTOR_REQUIRED",
            });
          }
          await ctx.context.internalAdapter.updateUser(user.id, { totpPasswordless: ctx.body.enabled });
          return ctx.json({ totpPasswordless: ctx.body.enabled });
        },
      ),
    },
    hooks: {
      after: [
        {
          // Turning two-factor off also turns passwordless sign-in off: re-enabling 2FA (with a new
          // secret) must not silently bring it back.
          matcher: (context) => context.path === "/two-factor/disable",
          handler: createAuthMiddleware(async (ctx) => {
            const userId = ctx.context.session?.user.id;
            if (!userId || ctx.context.returned instanceof Error) return;
            await ctx.context.internalAdapter.updateUser(userId, { totpPasswordless: false });
          }),
        },
      ],
    },
  };
}
