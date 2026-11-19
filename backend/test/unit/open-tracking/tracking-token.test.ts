import { describe, expect, it } from "vitest";
import {
  generateTrackingToken,
  isTrackingToken,
  TRACKING_TOKEN_LENGTH,
} from "@/open-tracking";

describe("generateTrackingToken", () => {
  it("returns 43 alphanumeric characters (about 256 bits)", () => {
    const token = generateTrackingToken();

    expect(token).toHaveLength(TRACKING_TOKEN_LENGTH);
    expect(token).toMatch(/^[A-Za-z0-9]+$/);
  });

  it("never repeats itself", () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateTrackingToken()));
    expect(tokens.size).toBe(500);
  });

  it("produces tokens that pass its own format check", () => {
    for (let i = 0; i < 50; i++) {
      expect(isTrackingToken(generateTrackingToken())).toBe(true);
    }
  });
});

describe("isTrackingToken", () => {
  it.each([
    ["empty", ""],
    ["too short", "a".repeat(42)],
    ["too long", "a".repeat(44)],
    ["base64url dash", `${"a".repeat(42)}-`],
    ["base64url underscore", `${"a".repeat(42)}_`],
    ["path traversal", `../${"a".repeat(40)}`],
    ["sql quote", `${"a".repeat(42)}'`],
    ["whitespace", `${"a".repeat(42)} `],
  ])("rejects %s", (_label, value) => {
    expect(isTrackingToken(value)).toBe(false);
  });
});
