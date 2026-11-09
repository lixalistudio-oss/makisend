import { describe, it, expect } from "vitest";

import type { Bindings } from "@/index";
import { checkEncryptionKeys, createConfig, resolveEncryptionKeys } from "@/config/config";
import { AppError, EncryptionKeyError } from "@/core/errors";

const KEY_A = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const KEY_B = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
const INVALID = "Encryption keys must be 64 hexadecimal characters (openssl rand -hex 32)";

const bindings = (keys: Partial<Pick<Bindings, "ENCRYPTION_KEY" | "ENCRYPTION_KEY_PREVIOUS" | "AES_256_KEY">>) =>
  ({ makisend_db: {} as D1Database, ...keys }) as Bindings;

describe("createConfig", () => {
  it("throws a 500 AppError when no encryption key is set", () => {
    expect(() => createConfig(bindings({}))).toThrow(AppError);
    expect(() => createConfig(bindings({ AES_256_KEY: "" }))).toThrow(
      new EncryptionKeyError("ENCRYPTION_KEY_MISSING", ["ENCRYPTION_KEY"], "ENCRYPTION_KEY environment variable is required"),
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
    expect(() => createConfig(bindings({ ENCRYPTION_KEY: key }))).toThrow(
      new EncryptionKeyError("ENCRYPTION_KEY_INVALID", ["ENCRYPTION_KEY"], INVALID),
    );
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
    expect(() => resolveEncryptionKeys({ ENCRYPTION_KEY: KEY_A, ENCRYPTION_KEY_PREVIOUS: "nope" })).toThrow(
      new EncryptionKeyError("ENCRYPTION_KEY_INVALID", ["ENCRYPTION_KEY_PREVIOUS"], INVALID),
    );
  });
});

describe("checkEncryptionKeys (what the dashboard is told)", () => {
  it("is null when the keys are usable", () => {
    expect(checkEncryptionKeys({ ENCRYPTION_KEY: KEY_A, ENCRYPTION_KEY_PREVIOUS: KEY_B })).toBeNull();
  });

  it("reports a missing key", () => {
    const error = checkEncryptionKeys({});
    expect(error).toBeInstanceOf(EncryptionKeyError);
    expect(error?.code).toBe("ENCRYPTION_KEY_MISSING");
    expect(error?.variables).toEqual(["ENCRYPTION_KEY"]);
  });

  it("names the placeholder left from .dev.vars.example as invalid ENCRYPTION_KEY", () => {
    const error = checkEncryptionKeys({ ENCRYPTION_KEY: "your_64_character_hexadecimal_string_here" });
    expect(error?.code).toBe("ENCRYPTION_KEY_INVALID");
    expect(error?.variables).toEqual(["ENCRYPTION_KEY"]);
  });

  it("names every malformed variable, and only those", () => {
    expect(checkEncryptionKeys({ ENCRYPTION_KEY: KEY_A, ENCRYPTION_KEY_PREVIOUS: `${KEY_B},nope` })?.variables).toEqual([
      "ENCRYPTION_KEY_PREVIOUS",
    ]);
    expect(checkEncryptionKeys({ ENCRYPTION_KEY: "short", AES_256_KEY: "also-short" })?.variables).toEqual([
      "ENCRYPTION_KEY",
      "AES_256_KEY",
    ]);
    expect(checkEncryptionKeys({ AES_256_KEY: "legacy-but-wrong" })?.variables).toEqual(["AES_256_KEY"]);
  });

  it("never carries a key value", () => {
    const secret = "f".repeat(63);
    const error = checkEncryptionKeys({ ENCRYPTION_KEY: secret });
    expect(JSON.stringify({ message: error?.message, variables: error?.variables })).not.toContain(secret);
  });
});
