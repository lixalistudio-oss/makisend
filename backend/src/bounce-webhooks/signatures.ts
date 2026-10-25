/**
 * Signature primitives for the providers' webhooks, on the Web Crypto API only (no Node
 * `crypto`, no Buffer): HMAC-SHA256 (Svix for Resend, Mailgun), ECDSA P-256 (SendGrid) and a
 * constant-time comparison for shared secrets (Postmark's Basic auth).
 */

const encoder = new TextEncoder();

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Base64 that `atob` accepts, or null. */
export function tryBase64ToBytes(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    return base64ToBytes(value);
  } catch {
    return null;
  }
}

export async function hmacSha256(key: Uint8Array, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey("raw", new Uint8Array(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message)));
}

/** Equal length and content, in time that depends only on the length. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** Compares two strings through their SHA-256, so neither the content nor the length leaks. */
export async function constantTimeStringEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  return constantTimeEqual(new Uint8Array(ha), new Uint8Array(hb));
}

/**
 * ECDSA signatures arrive DER-encoded (SEQUENCE { INTEGER r, INTEGER s }); Web Crypto verifies
 * the raw form, r and s as two fixed-size big-endian integers. Returns null when the input is
 * not such a sequence.
 */
export function derToRawEcdsaSignature(der: Uint8Array, size = 32): Uint8Array<ArrayBuffer> | null {
  let offset = 0;
  const readLength = (): number | null => {
    const first = der[offset++];
    if (first === undefined) return null;
    if (first < 0x80) return first;
    const count = first & 0x7f;
    if (count === 0 || count > 2) return null;
    let length = 0;
    for (let i = 0; i < count; i++) {
      const byte = der[offset++];
      if (byte === undefined) return null;
      length = (length << 8) | byte;
    }
    return length;
  };
  const readInteger = (): Uint8Array | null => {
    if (der[offset++] !== 0x02) return null;
    const length = readLength();
    if (length === null || length === 0 || offset + length > der.length) return null;
    let value = der.subarray(offset, offset + length);
    offset += length;
    // Strip the sign-padding zeros; a value still longer than `size` is not a P-256 integer.
    while (value.length > size && value[0] === 0) value = value.subarray(1);
    return value.length > size ? null : value;
  };

  if (der[offset++] !== 0x30) return null;
  const sequenceLength = readLength();
  if (sequenceLength === null || offset + sequenceLength !== der.length) return null;
  const r = readInteger();
  const s = readInteger();
  if (!r || !s || offset !== der.length) return null;

  const raw = new Uint8Array(size * 2);
  raw.set(r, size - r.length);
  raw.set(s, size * 2 - s.length);
  return raw;
}

/** Imports a base64 SubjectPublicKeyInfo P-256 key (the form SendGrid displays), or null. */
export async function importEcdsaP256PublicKey(base64Spki: string): Promise<CryptoKey | null> {
  const der = tryBase64ToBytes(base64Spki.replace(/\s+/g, ""));
  if (!der) return null;
  try {
    return await crypto.subtle.importKey("spki", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  } catch {
    return null;
  }
}

export async function verifyEcdsaP256Sha256(
  publicKey: CryptoKey,
  derSignature: Uint8Array,
  message: string,
): Promise<boolean> {
  const raw = derToRawEcdsaSignature(derSignature);
  if (!raw) return false;
  try {
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, raw, encoder.encode(message));
  } catch {
    return false;
  }
}
