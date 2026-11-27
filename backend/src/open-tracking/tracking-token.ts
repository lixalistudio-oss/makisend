import { generateRandomString } from "better-auth/crypto";

/**
 * 43 characters from a 62-letter alphabet: about 256 bits, the same strength as a 32-byte secret.
 * Better Auth's generator draws from `crypto.getRandomValues` without modulo bias; it is what
 * already creates the API keys.
 */
export const TRACKING_TOKEN_LENGTH = 43;

/** The only shape a tracking token can take: lets the pixel route reject garbage before D1. */
export const TRACKING_TOKEN_PATTERN = /^[A-Za-z0-9]{43}$/;

/** A fresh, unguessable token for one tracked email. Stored in clear: it unlocks nothing. */
export function generateTrackingToken(): string {
  return generateRandomString(TRACKING_TOKEN_LENGTH, "a-z", "A-Z", "0-9");
}

export function isTrackingToken(value: string): boolean {
  return TRACKING_TOKEN_PATTERN.test(value);
}
