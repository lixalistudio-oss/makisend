import { describe, it, expect } from "vitest";

import { encrypt, decrypt } from "@/core/crypto";

const VALID_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("crypto", () => {
  describe("encrypt / decrypt", () => {
    it("should round-trip a value", async () => {
      const encrypted = await encrypt("alice@example.com", VALID_KEY);
      const decrypted = await decrypt(encrypted, VALID_KEY);
      expect(decrypted).toBe("alice@example.com");
    });

    it("should produce a fresh IV per encryption (ciphertext differs)", async () => {
      const a = await encrypt("alice@example.com", VALID_KEY);
      const b = await encrypt("alice@example.com", VALID_KEY);
      expect(a).not.toBe(b);
    });

    it("should return an empty string for empty input", async () => {
      expect(await encrypt("", VALID_KEY)).toBe("");
      expect(await decrypt("", VALID_KEY)).toBe("");
    });

    it("should fail to decrypt with a different key", async () => {
      const encrypted = await encrypt("alice@example.com", VALID_KEY);
      const otherKey = "f".repeat(64);
      await expect(decrypt(encrypted, otherKey)).rejects.toThrow();
    });
  });

  describe("key validation", () => {
    const expectedError = "Invalid AES-256 key: expected 64 hexadecimal characters";

    it("should reject encrypt with a key that is too short", async () => {
      await expect(encrypt("alice@example.com", "abc123")).rejects.toThrow(expectedError);
    });

    it("should reject encrypt with a key that is too long", async () => {
      await expect(encrypt("alice@example.com", "a".repeat(65))).rejects.toThrow(expectedError);
    });

    it("should reject encrypt with non-hex characters", async () => {
      await expect(
        encrypt("alice@example.com", "z".repeat(64)),
      ).rejects.toThrow(expectedError);
    });

    it("should reject decrypt with a malformed key", async () => {
      const encrypted = await encrypt("alice@example.com", VALID_KEY);
      await expect(decrypt(encrypted, "not-a-key")).rejects.toThrow(expectedError);
    });
  });
});
