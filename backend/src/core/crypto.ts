/**
 * AES-256-GCM encryption with key rotation.
 *
 * Ciphertext (JSON stored as text in D1): `{"kid":"<16 hex>","iv":"<24 hex>","data":"<hex>"}`.
 * `kid` is a public fingerprint of the key that encrypted the value (first 8 bytes of
 * SHA-256 of the key), never the key itself. `kid` is always the FIRST property: the
 * key-rotation job finds stale rows with `NOT LIKE '{"kid":"<current>"%'`.
 * Values written before rotation existed have no `kid`; every configured key is tried.
 *
 * The Worker holds one current key (encrypts everything new) and optional previous keys
 * (decrypt only). The key-rotation job re-encrypts every value whose `kid` is not the
 * current one; once nothing is left, the previous keys can be deleted.
 */

export interface EncryptionKeys {
  /** Encrypts every new value. 64 hex characters (32 bytes). */
  current: string;
  /** Decrypt-only keys, tried after the current one. */
  previous: readonly string[];
}

/** A bare hex key is a keyring with no previous key. */
export type KeyMaterial = string | EncryptionKeys;

interface Envelope {
  kid?: string;
  iv: string;
  data: string;
}

const HEX_KEY = /^[0-9a-fA-F]{64}$/;

export function isValidKeyHex(key: string): boolean {
  return HEX_KEY.test(key);
}

function toKeys(material: KeyMaterial): EncryptionKeys {
  return typeof material === "string" ? { current: material, previous: [] } : material;
}

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const keyIdCache = new Map<string, Promise<string>>();

/** Public fingerprint of a key: first 8 bytes of SHA-256(key bytes), as hex. */
export function keyId(secretKeyHex: string): Promise<string> {
  let id = keyIdCache.get(secretKeyHex);
  if (!id) {
    id = crypto.subtle
      .digest("SHA-256", hexToUint8Array(secretKeyHex))
      .then((hash) => uint8ArrayToHex(new Uint8Array(hash).slice(0, 8)));
    keyIdCache.set(secretKeyHex, id);
  }
  return id;
}

function importKey(secretKeyHex: string): Promise<CryptoKey> {
  // A malformed key must fail loudly, not with an opaque OperationError from Web Crypto.
  if (!isValidKeyHex(secretKeyHex)) {
    return Promise.reject(new Error("Invalid AES-256 key: expected 64 hexadecimal characters"));
  }
  return crypto.subtle.importKey(
    "raw",
    hexToUint8Array(secretKeyHex),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encrypt(plainText: string, material: KeyMaterial): Promise<string> {
  if (!plainText) return "";

  const { current } = toKeys(material);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await importKey(current),
    new TextEncoder().encode(plainText),
  );

  const envelope: Envelope = {
    kid: await keyId(current),
    iv: uint8ArrayToHex(iv),
    data: uint8ArrayToHex(new Uint8Array(encryptedBuffer)),
  };
  return JSON.stringify(envelope);
}

/**
 * Keys to try, in order: those whose fingerprint matches `kid`, then the others
 * (current before previous). AES-GCM authenticates the ciphertext, so a wrong key
 * fails loudly instead of returning garbage.
 */
async function candidateKeys(keys: EncryptionKeys, kid: string | undefined): Promise<string[]> {
  const all = [keys.current, ...keys.previous];
  if (!kid) return all;
  const ids = await Promise.all(all.map(keyId));
  return [...all.filter((_, i) => ids[i] === kid), ...all.filter((_, i) => ids[i] !== kid)];
}

export async function decrypt(encryptedJson: string, material: KeyMaterial): Promise<string> {
  if (!encryptedJson) return "";

  const keys = toKeys(material);
  for (const key of [keys.current, ...keys.previous]) {
    if (!isValidKeyHex(key)) throw new Error("Invalid AES-256 key: expected 64 hexadecimal characters");
  }
  const { kid, iv, data } = JSON.parse(encryptedJson) as Envelope;
  const ivBuffer = hexToUint8Array(iv);
  const dataBuffer = hexToUint8Array(data);

  for (const key of await candidateKeys(keys, kid)) {
    try {
      const decryptedBuffer = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: ivBuffer },
        await importKey(key),
        dataBuffer,
      );
      return new TextDecoder().decode(decryptedBuffer);
    } catch {
      // Not this key: try the next one.
    }
  }
  throw new Error("Unable to decrypt the value with any configured encryption key");
}

/** Decrypts with whichever configured key works and re-encrypts with the current one. */
export async function reEncrypt(encryptedJson: string, material: KeyMaterial): Promise<string> {
  if (!encryptedJson) return "";
  return encrypt(await decrypt(encryptedJson, material), material);
}

/** SQL `LIKE` prefix matching every value encrypted with `currentKey`. */
export async function currentKeyPrefix(currentKey: string): Promise<string> {
  return `{"kid":"${await keyId(currentKey)}"%`;
}
