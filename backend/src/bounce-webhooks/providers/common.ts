/** Reading untyped provider JSON without casts, and the rule that decides a hard bounce. */

export type JsonObject = Record<string, unknown>;

export function asObject(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : null;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** A number or a numeric string, as a string ("550"), or null. */
export function asCode(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && /^\d{3}$/.test(value.trim()) ? value.trim() : null;
}

/** An RFC 3463 enhanced status ("5.1.1"), or null. */
export function asEnhancedStatus(value: unknown): string | null {
  return typeof value === "string" && /^[245]\.\d{1,3}\.\d{1,3}$/.test(value.trim()) ? value.trim() : null;
}

/** A real address: providers that redact recipients send placeholders such as "[REDACTED]". */
export function asAddress(value: unknown): string | null {
  const address = asString(value)?.trim();
  return address && /^[^\s@<>]+@[^\s@<>]+$/.test(address) ? address : null;
}

/** Enhanced statuses that say the address itself does not work (same set as the RCPT TO rule). */
const DEAD_ADDRESS_STATUSES = new Set(["5.1.1", "5.1.2", "5.1.3", "5.1.6", "5.1.10", "5.2.1"]);

/**
 * Whether a permanent failure the provider reported means the address is dead, so it may be
 * suppressed. The status code wins when there is one: a dead-address code is enough, while a
 * policy (5.7.x), content (5.6.x), system (5.3.x) or full-mailbox (5.2.2, 5.2.3) code never
 * suppresses, whatever the provider's own label says. Without a code, the provider's own
 * address-level verdict decides. Suppressing a working address is the worse mistake.
 */
export function isDeadAddress(enhancedStatus: string | null, providerSaysAddressFailed: boolean): boolean {
  if (enhancedStatus) {
    if (DEAD_ADDRESS_STATUSES.has(enhancedStatus)) return true;
    if (/^5\.(3|6|7)\./.test(enhancedStatus) || enhancedStatus === "5.2.2" || enhancedStatus === "5.2.3") {
      return false;
    }
  }
  return providerSaysAddressFailed;
}

/** Case-insensitive lookup in a provider's metadata object. */
export function readKey(object: JsonObject | null, key: string): unknown {
  if (!object) return undefined;
  const wanted = key.toLowerCase();
  for (const [name, value] of Object.entries(object)) {
    if (name.toLowerCase() === wanted) return value;
  }
  return undefined;
}

/** The key MakiSend's email id travels under in the providers' echoed tags. */
export const EMAIL_ID_TAG = "makisend_email_id";
