import { describe, it, expect } from "vitest";
import { decodeCursor } from "@/email-logs/email-logs.repository";

describe("decodeCursor", () => {
  it("preserves the full ISO timestamp when splitting the cursor", () => {
    expect(decodeCursor("2026-01-01T00:00:00.000Z:log-123")).toEqual({
      createdAt: "2026-01-01T00:00:00.000Z",
      internalId: "log-123",
    });
  });

  it("rejects cursors without both parts", () => {
    expect(decodeCursor("log-123")).toBeNull();
    expect(decodeCursor(":log-123")).toBeNull();
    expect(decodeCursor("2026-01-01T00:00:00.000Z:")).toBeNull();
  });
});
