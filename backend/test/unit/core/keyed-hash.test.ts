import { describe, it, expect } from "vitest";
import { keyedHash, keyedHashes } from "@/core/crypto";

const KEY_A = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const KEY_B = "f".repeat(64);

describe("keyedHash", () => {
  it("is deterministic for one key and purpose", async () => {
    const a = await keyedHash("alice@example.com", KEY_A, "suppression-recipient");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await keyedHash("alice@example.com", KEY_A, "suppression-recipient")).toBe(a);
  });

  it("changes with the key, the purpose and the value", async () => {
    const base = await keyedHash("alice@example.com", KEY_A, "p1");
    expect(await keyedHash("alice@example.com", KEY_B, "p1")).not.toBe(base);
    expect(await keyedHash("alice@example.com", KEY_A, "p2")).not.toBe(base);
    expect(await keyedHash("bob@example.com", KEY_A, "p1")).not.toBe(base);
  });

  it("is not a plain HMAC of the value with the AES key (sub-key derivation)", async () => {
    const raw = await crypto.subtle.importKey(
      "raw",
      Uint8Array.from(KEY_A.match(/../g)!.map((h) => parseInt(h, 16))),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const plain = new Uint8Array(await crypto.subtle.sign("HMAC", raw, new TextEncoder().encode("alice@example.com")));
    const plainHex = Array.from(plain, (b) => b.toString(16).padStart(2, "0")).join("");
    expect(await keyedHash("alice@example.com", KEY_A, "p1")).not.toBe(plainHex);
  });

  it("hashes under every configured key, current first", async () => {
    const hashes = await keyedHashes("alice@example.com", { current: KEY_B, previous: [KEY_A] }, "p1");
    expect(hashes).toEqual([await keyedHash("alice@example.com", KEY_B, "p1"), await keyedHash("alice@example.com", KEY_A, "p1")]);
  });

  it("refuses a malformed key", async () => {
    await expect(keyedHash("x", "not-a-key", "p1")).rejects.toThrow("Invalid AES-256 key");
  });
});
