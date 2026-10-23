import { AppError } from "@/core/errors";
import type { Bindings } from "@/index";

export interface SmtpConfig {
  smtpHostName: string;
  senderEmail: string;
  smtpUsername: string;
  smtpPassword: string;
}
export interface UserConfig {
  userId: string;
}
export interface Config {
  port: number;
  aesKey: string;
  db: D1Database;
  better_auth_url: string;
  better_auth_secret: string;
}

// AES-256-GCM requires a 256-bit key. We accept it as 64 hexadecimal
// characters, i.e. the exact output of `openssl rand -hex 32`.
const AES_256_KEY_HEX = /^[0-9a-fA-F]{64}$/;

export function createConfig(env: Bindings): Config {
  if (!env.AES_256_KEY) {
    throw new AppError(500, "AES_256_KEY environment variable is required");
  }

  if (!AES_256_KEY_HEX.test(env.AES_256_KEY)) {
    // Refuse to serve requests with a malformed key instead of letting
    // encrypt/decrypt fail later with an opaque OperationError.
    throw new AppError(
      500,
      "AES_256_KEY must be a 64-character hexadecimal string (generate one with: openssl rand -hex 32)",
    );
  }

  if (!env.makisend_db) {
    throw new AppError(500, "makisend_db environment variable is required");
  }

  return {
    port: env.PORT,
    aesKey: env.AES_256_KEY,
    db: env.makisend_db,
    better_auth_url: env.BETTER_AUTH_URL,
    better_auth_secret: env.BETTER_AUTH_SECRET,
  };
}
