import { describe, it, expect } from "vitest";

import type { Bindings } from "@/index";
import { createConfig, resolveEncryptionKeys } from "@/config/config";
import { AppError } from "@/core/errors";

const KEY_A = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const KEY_B = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
const INVALID = "Encryption keys must be 64 hexadecimal characters (openssl rand -hex 32)";

const bindings = (keys: Partial<Pick<Bindings, "ENCRYPTION_KEY" | "ENCRYPTION_KEY_PREVIOUS" | "AES_256_KEY">>) =>
  ({ makisend_db: {} as D1Database, ...keys }) as Bindings;

describe("createConfig", () => {
  it("throws when no encryption key is set", () => {
    expect(() => createConfig(bindings({ AES_256_KEY: "" }))).toThrow(
      new AppError(500, "ENCRYPTION_KEY environment variable is required"),
    );
  });

  it("uses ENCRYPTION_KEY as the current key", () => {
    expect(createConfig(bindings({ ENCRYPTION_KEY: KEY_A })).aesKey).toEqual({ current: KEY_A, previous: [] });
  });

  it("still reads the legacy AES_256_KEY alone", () => {
    expect(createConfig(bindings({ AES_256_KEY: KEY_A })).aesKey).toEqual({ current: KEY_A, previous: [] });
  });

  it("accepts an uppercase 64-char hex key", () => {
    expect(createConfig(bindings({ ENCRYPTION_KEY: KEY_A.toUpperCase() })).aesKey.current).toHaveLength(64);
  });

  it.each([
    ["too short", "0123456789abcdef"],
    ["too long", "0".repeat(65)],
    ["non-hex", "z".repeat(64)],
  ])("throws when the key is %s", (_label, key) => {
    expect(() => createConfig(bindings({ ENCRYPTION_KEY: key }))).toThrow(new AppError(500, INVALID));
  });
});

describe("resolveEncryptionKeys (rotation)", () => {
  it("keeps ENCRYPTION_KEY_PREVIOUS as decrypt-only keys", () => {
    expect(resolveEncryptionKeys({ ENCRYPTION_KEY: KEY_B, ENCRYPTION_KEY_PREVIOUS: ` ${KEY_A} ,` })).toEqual({
      current: KEY_B,
      previous: [KEY_A],
    });
  });

  it("keeps a legacy AES_256_KEY readable once ENCRYPTION_KEY replaces it", () => {
    expect(resolveEncryptionKeys({ ENCRYPTION_KEY: KEY_B, AES_256_KEY: KEY_A })).toEqual({ current: KEY_B, previous: [KEY_A] });
  });

  it("drops a previous key equal to the current one", () => {
    expect(resolveEncryptionKeys({ ENCRYPTION_KEY: KEY_A, ENCRYPTION_KEY_PREVIOUS: KEY_A, AES_256_KEY: KEY_A })).toEqual({
      current: KEY_A,
      previous: [],
    });
  });

  it("refuses a malformed previous key", () => {
    expect(() => resolveEncryptionKeys({ ENCRYPTION_KEY: KEY_A, ENCRYPTION_KEY_PREVIOUS: "nope" })).toThrow(new AppError(500, INVALID));
  });
});
