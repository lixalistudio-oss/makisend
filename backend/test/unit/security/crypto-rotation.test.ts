import { describe, it, expect } from "vitest";

import { currentKeyPrefix, decrypt, encrypt, keyId, reEncrypt } from "@/core/crypto";

const OLD_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const NEW_KEY = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
const OTHER_KEY = "aa".repeat(32);

/** Ciphertext as written before key ids existed: `{"iv","data"}`, no `kid`. */
async function legacyCiphertext(plainText: string, keyHex: string): Promise<string> {
  const { iv, data } = JSON.parse(await encrypt(plainText, keyHex)) as { iv: string; data: string };
  return JSON.stringify({ iv, data });
}

describe("crypto with key rotation", () => {
  it("tags the ciphertext with the current key id, as its first property", async () => {
    const value = await encrypt("secret", { current: NEW_KEY, previous: [OLD_KEY] });

    expect(value.startsWith(`{"kid":"${await keyId(NEW_KEY)}"`)).toBe(true);
    expect(value.includes(NEW_KEY)).toBe(false);
  });

  it("decrypts a value encrypted with a previous key", async () => {
    const value = await encrypt("smtp-password", OLD_KEY);

    expect(await decrypt(value, { current: NEW_KEY, previous: [OLD_KEY] })).toBe("smtp-password");
  });

  it("decrypts a legacy value without key id by trying every key", async () => {
    const value = await legacyCiphertext("legacy@example.com", OLD_KEY);

    expect(await decrypt(value, { current: NEW_KEY, previous: [OLD_KEY] })).toBe("legacy@example.com");
  });

  it("fails when no configured key matches", async () => {
    const value = await encrypt("secret", OTHER_KEY);

    await expect(decrypt(value, { current: NEW_KEY, previous: [OLD_KEY] })).rejects.toThrow(
      "Unable to decrypt the value with any configured encryption key",
    );
  });

  it("re-encrypts a previous-key value with the current key", async () => {
    const keys = { current: NEW_KEY, previous: [OLD_KEY] };
    const rotated = await reEncrypt(await legacyCiphertext("body", OLD_KEY), keys);

    expect(rotated.startsWith((await currentKeyPrefix(NEW_KEY)).slice(0, -1))).toBe(true);
    expect(await decrypt(rotated, NEW_KEY)).toBe("body");
  });

  it("keeps empty values empty", async () => {
    expect(await encrypt("", NEW_KEY)).toBe("");
    expect(await decrypt("", NEW_KEY)).toBe("");
    expect(await reEncrypt("", NEW_KEY)).toBe("");
  });
});
