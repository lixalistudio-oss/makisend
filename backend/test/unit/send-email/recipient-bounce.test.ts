import { describe, it, expect } from "vitest";
import { isRecipientHardBounce, recipientRejectionReason } from "@/send-email/error-classifier";

const rcpt = (response: string) => ({
  code: "EENVELOPE",
  command: "RCPT TO",
  responseCode: Number(response.slice(0, 3)),
  message: `Can't send mail - all recipients were rejected: ${response}`,
});

describe("isRecipientHardBounce", () => {
  it.each([
    "550 5.1.1 <ghost@example.com>: Recipient address rejected: User unknown in virtual mailbox table",
    "550 5.1.10 RESOLVER.ADR.RecipientNotFound; Recipient not found by SMTP address lookup",
    "553 5.1.3 The recipient address <a@> is not a valid RFC 5321 address",
    "550 5.2.1 The email account that you tried to reach is disabled",
    "550 5.1.2 Host unknown, domain not found",
    "550 No such user here",
    "550 Requested action not taken: mailbox unavailable",
  ])("suppresses on %s", (response) => {
    expect(isRecipientHardBounce(rcpt(response))).toBe(true);
  });

  it.each([
    // Policy, relay, reputation: the address may be fine.
    "550 5.7.1 Relaying denied",
    "554 5.7.1 Service unavailable; Client host blocked using Spamhaus",
    "550 5.7.26 Unauthenticated email is not accepted from this domain",
    // Full mailbox: temporary in practice.
    "552 5.2.2 Mailbox full",
    // Temporary statuses.
    "450 4.1.1 Recipient address rejected: unverified address",
    "451 4.7.1 Greylisted, try again later",
    // Permanent but says nothing about the address.
    "550 Message rejected",
    // An IP address in the reply must not be read as a 5.1.x status.
    "550 Rejected from 192.5.1.10 by policy",
  ])("does not suppress on %s", (response) => {
    expect(isRecipientHardBounce(rcpt(response))).toBe(false);
  });

  it("ignores rejections outside RCPT TO", () => {
    expect(
      isRecipientHardBounce({
        code: "EENVELOPE",
        command: "MAIL FROM",
        responseCode: 550,
        message: "Mail command failed: 550 5.1.1 Sender address unknown",
      }),
    ).toBe(false);
    expect(isRecipientHardBounce({ code: "EAUTH", command: "AUTH PLAIN", responseCode: 535, message: "Invalid login: 535 5.7.8" })).toBe(false);
  });

  it("recognizes a serialized error without command or responseCode", () => {
    expect(
      isRecipientHardBounce({ message: "Can't send mail - all recipients were rejected: 550 5.1.1 User unknown" }),
    ).toBe(true);
  });
});

describe("recipientRejectionReason", () => {
  it("keeps the status codes and drops the server's text", () => {
    const reason = recipientRejectionReason(rcpt("550 5.1.1 <ghost@example.com>: User unknown"));
    expect(reason).toBe("The recipient's server rejected the address (550 5.1.1).");
    expect(reason).not.toContain("ghost");
  });
});
