import { describe, expect, it } from "vitest";
import { TRANSPARENT_GIF } from "@/open-tracking";

describe("TRANSPARENT_GIF", () => {
  it("is a GIF89a file", () => {
    expect(new TextDecoder().decode(TRANSPARENT_GIF.subarray(0, 6))).toBe("GIF89a");
  });

  it("is 1x1 pixel (little-endian width and height after the signature)", () => {
    const view = new DataView(TRANSPARENT_GIF.buffer, TRANSPARENT_GIF.byteOffset);
    expect(view.getUint16(6, true)).toBe(1);
    expect(view.getUint16(8, true)).toBe(1);
  });

  it("declares a transparent color in its graphic control extension", () => {
    // 0x21 0xF9 0x04 <packed>: bit 0 of the packed byte is the transparency flag.
    const start = TRANSPARENT_GIF.findIndex(
      (byte, i) => byte === 0x21 && TRANSPARENT_GIF[i + 1] === 0xf9 && TRANSPARENT_GIF[i + 2] === 0x04,
    );
    expect(start).toBeGreaterThan(0);
    expect(TRANSPARENT_GIF[start + 3] & 0x01).toBe(1);
  });

  it("ends with the GIF trailer and stays tiny", () => {
    expect(TRANSPARENT_GIF.at(-1)).toBe(0x3b);
    expect(TRANSPARENT_GIF.byteLength).toBe(42);
  });
});
