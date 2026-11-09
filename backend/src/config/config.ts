import { AppError, EncryptionKeyError } from "@/core/errors";
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

const MISSING_KEY_MESSAGE = "ENCRYPTION_KEY environment variable is required";
const INVALID_KEY_MESSAGE = "Encryption keys must be 64 hexadecimal characters (openssl rand -hex 32)";

/**
 * What is wrong with the encryption secrets, `null` when they are usable. Names the offending
 * variables, never their values: the answer is public (`GET /api/setup-status`).
 */
export function checkEncryptionKeys(env: EncryptionKeyBindings): EncryptionKeyError | null {
  try {
    resolveEncryptionKeys(env);
    return null;
  } catch (error) {
    if (error instanceof EncryptionKeyError) return error;
    throw error;
  }
}

/**
 * Builds the keyring from the Worker secrets:
 * - `ENCRYPTION_KEY`: current key, encrypts everything new.
 * - `ENCRYPTION_KEY_PREVIOUS`: optional, decrypt-only keys, comma-separated.
 * - `AES_256_KEY`: legacy name. Used as the current key when `ENCRYPTION_KEY` is unset;
 *   otherwise kept as a previous key, so data it encrypted stays readable until the
 *   key-rotation job has re-encrypted it. Delete it once the job reports 0 values left.
 */
export function resolveEncryptionKeys(env: EncryptionKeyBindings): EncryptionKeys {
  const fromEncryptionKey = env.ENCRYPTION_KEY?.trim();
  const current = fromEncryptionKey || env.AES_256_KEY?.trim();
  if (!current) {
    throw new EncryptionKeyError("ENCRYPTION_KEY_MISSING", ["ENCRYPTION_KEY"], MISSING_KEY_MESSAGE);
  }

  const previous = (env.ENCRYPTION_KEY_PREVIOUS ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  const legacy = env.AES_256_KEY?.trim();

  const invalid = new Set<string>();
  if (!isValidKeyHex(current)) invalid.add(fromEncryptionKey ? "ENCRYPTION_KEY" : "AES_256_KEY");
  if (previous.some((key) => !isValidKeyHex(key))) invalid.add("ENCRYPTION_KEY_PREVIOUS");
  if (legacy && !isValidKeyHex(legacy)) invalid.add("AES_256_KEY");
  if (invalid.size > 0) {
    throw new EncryptionKeyError("ENCRYPTION_KEY_INVALID", [...invalid], INVALID_KEY_MESSAGE);
  }

  if (legacy) previous.push(legacy);
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
    better_auth_url: env.BETTER_AUTH_URL ?? "",
    better_auth_secret: env.BETTER_AUTH_SECRET,
  };
}
