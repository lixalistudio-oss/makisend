import { AppError } from "@/core/errors";
import { isValidKeyHex, type EncryptionKeys } from "@/core/crypto";
import type { Bindings } from "@/index";

export interface SmtpConfig {
  smtpHostName: string;
  /** Optional only for rows read before the port/security columns existed. */
  smtpPort?: number;
  smtpSecurity?: "tls" | "starttls";
  senderEmail: string;
  smtpUsername: string;
  smtpPassword: string;
}
export interface UserConfig {
  userId: string;
}
export interface Config {
  aesKey: EncryptionKeys;
  db: D1Database;
  better_auth_url: string;
  better_auth_secret: string;
}

type EncryptionKeyBindings = Pick<Bindings, "ENCRYPTION_KEY" | "ENCRYPTION_KEY_PREVIOUS" | "AES_256_KEY">;

/**
 * Builds the keyring from the Worker secrets:
 * - `ENCRYPTION_KEY`: current key, encrypts everything new.
 * - `ENCRYPTION_KEY_PREVIOUS`: optional, decrypt-only keys, comma-separated.
 * - `AES_256_KEY`: legacy name. Used as the current key when `ENCRYPTION_KEY` is unset;
 *   otherwise kept as a previous key, so data it encrypted stays readable until the
 *   key-rotation job has re-encrypted it. Delete it once the job reports 0 values left.
 */
export function resolveEncryptionKeys(env: EncryptionKeyBindings): EncryptionKeys {
  const current = env.ENCRYPTION_KEY?.trim() || env.AES_256_KEY?.trim();
  if (!current) {
    throw new AppError(500, "ENCRYPTION_KEY environment variable is required");
  }

  const previous = (env.ENCRYPTION_KEY_PREVIOUS ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  const legacy = env.AES_256_KEY?.trim();
  if (legacy) previous.push(legacy);

  const invalid = [current, ...previous].filter((key) => !isValidKeyHex(key));
  if (invalid.length > 0) {
    throw new AppError(500, "Encryption keys must be 64 hexadecimal characters (openssl rand -hex 32)");
  }

  return { current, previous: [...new Set(previous)].filter((key) => key !== current) };
}

export function createConfig(env: Bindings): Config {
  const aesKey = resolveEncryptionKeys(env);

  if (!env.makisend_db) {
    throw new AppError(500, "makisend_db environment variable is required");
  }

  return {
    aesKey,
    db: env.makisend_db,
    better_auth_url: env.BETTER_AUTH_URL,
    better_auth_secret: env.BETTER_AUTH_SECRET,
  };
}
