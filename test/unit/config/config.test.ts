import { describe, it, expect } from "vitest";

import type { Bindings } from "@/index";
import { createConfig } from "@/config/config";
import { AppError } from "@/core/errors";

const baseBindings = {
  HOST: "smtp.example.com",
  PORT: 587,
  SMTP_USER: "user@example.com",
  SMTP_PASSWORD: "secret",
  SENDER_EMAIL: "noreply@example.com",
  API_KEY: "api-key",
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
    expect(config.smtp.host).toBe("smtp.example.com");
  });
});
