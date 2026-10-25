import { describe, it, expect } from "vitest";
import {
  CustomHeadersDto,
  MAX_CUSTOM_HEADERS,
  MAX_HEADER_VALUE_BYTES,
  canonicalHeaderName,
} from "@/send-email/custom-headers";

const issues = (input: unknown) => {
  const result = CustomHeadersDto.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

describe("CustomHeadersDto", () => {
  it("accepts X- headers and the allowlist, under their documented spelling", () => {
    expect(
      CustomHeadersDto.parse({
        "x-entity-ref-id": "  abc  ",
        "in-reply-to": "<m1@example.com>",
        references: "<m0@example.com> <m1@example.com>",
        PRECEDENCE: "bulk",
        "List-Id": "Receipts <receipts.example.com>",
      }),
    ).toEqual({
      "X-entity-ref-id": "abc",
      "In-Reply-To": "<m1@example.com>",
      References: "<m0@example.com> <m1@example.com>",
      Precedence: "bulk",
      "List-Id": "Receipts <receipts.example.com>",
    });
  });

  it("accepts one-click unsubscribe with an https link", () => {
    expect(
      issues({
        "List-Unsubscribe": "<mailto:u@example.com>, <https://example.com/u?t=1>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      }),
    ).toEqual([]);
  });

  it.each(["From", "to", "CC", "Bcc", "Subject"])("sends %s to its own field", (name) => {
    expect(issues({ [name]: "x@example.com" })[0]).toMatch(/use the .* field/);
  });

  it("points Reply-To at reply_to", () => {
    expect(issues({ "reply-to": "x@example.com" })[0]).toContain("reply_to");
  });

  it.each(["Date", "Message-ID", "MIME-Version", "Content-Type", "DKIM-Signature", "Return-Path", "Received", "X Bad", "X-", "Importance", "X-Ünicode"])(
    "refuses %s",
    (name) => {
      expect(issues({ [name]: "v" })[0]).toMatch(/not allowed/);
    },
  );

  it.each(["a\r\nBcc: x@example.com", "a\nb", "a\u0000b", "a\u007fb"])("refuses a value with control characters (%j)", (value) => {
    expect(issues({ "X-A": value })[0]).toMatch(/line breaks or control characters/);
  });

  it("refuses the same header twice, whatever its case", () => {
    expect(issues({ "X-Ref": "1", "x-ref": "2" })[0]).toMatch(/set twice/);
  });

  it("refuses empty, oversized and too many values", () => {
    expect(issues({ "X-A": "   " })[0]).toMatch(/cannot be empty/);
    expect(issues({ "X-A": "é".repeat(MAX_HEADER_VALUE_BYTES / 2 + 1) })[0]).toMatch(/at most 2048 bytes/);
    const many = Object.fromEntries(Array.from({ length: MAX_CUSTOM_HEADERS + 1 }, (_, i) => [`X-H${i}`, "v"]));
    expect(issues(many)[0]).toMatch(/At most 50/);
  });

  it("checks List-Unsubscribe, List-Unsubscribe-Post and Precedence values", () => {
    expect(issues({ "List-Unsubscribe": "https://example.com/u" })[0]).toMatch(/URIs/);
    expect(issues({ "List-Unsubscribe": "<http://example.com/u>" })[0]).toMatch(/URIs/);
    expect(issues({ "List-Unsubscribe": "<https://example.com/u>", "List-Unsubscribe-Post": "one-click" })[0]).toMatch(/exactly/);
    expect(issues({ "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" })[0]).toMatch(/needs a List-Unsubscribe/);
    expect(issues({ Precedence: "urgent" })[0]).toMatch(/bulk, list or junk/);
  });

  it("canonicalizes names or returns null", () => {
    expect(canonicalHeaderName("list-unsubscribe")).toBe("List-Unsubscribe");
    expect(canonicalHeaderName("x-foo_bar")).toBe("X-foo_bar");
    expect(canonicalHeaderName("Keywords")).toBeNull();
  });
});
