import { describe, it, expect } from "vitest";

import type { Bindings } from "@/index";
import { createConfig } from "@/config/config";
import { AppError } from "@/core/errors";

const baseBindings = {
  PORT: 587,
  makisend_db: {} as D1Database,
};

describe("createConfig", () => {
  it("should throw an AppError when AES_256_KEY is not set", () => {
    expect(() =>
      createConfig({
        ...baseBindings,
        AES_256_KEY: "",
      } as Bindings),
    ).toThrow(new AppError(500, "AES_256_KEY environment variable is required"));
  });

  it("should return a config when AES_256_KEY is set", () => {
    const config = createConfig({
      ...baseBindings,
      AES_256_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    } as Bindings);

    expect(config.aesKey).toBe("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
    expect(config.port).toBe(587);
  });

  it("should accept an uppercase 64-char hex AES_256_KEY", () => {
    const config = createConfig({
      ...baseBindings,
      AES_256_KEY: "0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF",
    } as Bindings);

    expect(config.aesKey).toHaveLength(64);
  });

  it("should throw an AppError when AES_256_KEY is too short", () => {
    expect(() =>
      createConfig({
        ...baseBindings,
        AES_256_KEY: "0123456789abcdef",
      } as Bindings),
    ).toThrow(new AppError(500, "AES_256_KEY must be a 64-character hexadecimal string (generate one with: openssl rand -hex 32)"));
  });

  it("should throw an AppError when AES_256_KEY is too long", () => {
    expect(() =>
      createConfig({
        ...baseBindings,
        AES_256_KEY: "0".repeat(65),
      } as Bindings),
    ).toThrow(AppError);
  });

  it("should throw an AppError when AES_256_KEY contains non-hex characters", () => {
    expect(() =>
      createConfig({
        ...baseBindings,
        AES_256_KEY: "zzzz456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      } as Bindings),
    ).toThrow(AppError);
  });
});
