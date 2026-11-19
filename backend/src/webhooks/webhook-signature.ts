import { WEBHOOK_SECRET_BYTES, WEBHOOK_SECRET_PREFIX } from "./webhooks.constants";

/**
 * Signing secrets and signatures, in the Standard Webhooks format (https://www.standardwebhooks.com/),
 * so a receiver can verify with the official `standardwebhooks` library.
 *
 *   key       = base64decode(secret without "whsec_")      → 32 bytes
 *   content   = `${webhookId}.${timestampSeconds}.${body}`
 *   signature = "v1," + base64(HMAC-SHA256(key, content))
 *
 * The URL is not signed: it is only where the request goes. Web Crypto only, no Buffer.
 */

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** A new signing secret: 32 bytes from the CSPRNG, standard base64, `whsec_` prefix. */
export function generateSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(WEBHOOK_SECRET_BYTES));
  return `${WEBHOOK_SECRET_PREFIX}${toBase64(bytes)}`;
}

/** The HMAC key of a secret: the decoded bytes after the prefix, never the `whsec_…` string itself. */
function secretKeyBytes(secret: string): Uint8Array {
  if (!secret.startsWith(WEBHOOK_SECRET_PREFIX)) {
    throw new Error("Webhook secret must start with whsec_");
  }
  const bytes = fromBase64(secret.slice(WEBHOOK_SECRET_PREFIX.length));
  if (bytes.length === 0) throw new Error("Webhook secret is empty");
  return bytes;
}

/**
 * One `v1,<base64>` signature. `body` must be the exact string that is sent: serialize once,
 * sign it, send it, never re-serialize in between.
 */
export async function signWebhook(
  secret: string,
  webhookId: string,
  timestampSeconds: number,
  body: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    secretKeyBytes(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const content = new TextEncoder().encode(`${webhookId}.${timestampSeconds}.${body}`);
  const mac = await crypto.subtle.sign("HMAC", key, content);
  return `v1,${toBase64(new Uint8Array(mac))}`;
}

/**
 * The `webhook-signature` header: one signature per valid secret, space-separated, newest
 * first. During a rotation the receiver accepts the message if any of them matches.
 */
export async function buildSignatureHeader(
  secrets: readonly string[],
  webhookId: string,
  timestampSeconds: number,
  body: string,
): Promise<string> {
  if (secrets.length === 0) throw new Error("At least one secret is required to sign a webhook");
  const signatures = await Promise.all(
    secrets.map((secret) => signWebhook(secret, webhookId, timestampSeconds, body)),
  );
  return signatures.join(" ");
}
