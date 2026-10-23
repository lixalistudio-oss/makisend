import { describe, it, expect } from "vitest";
import {
  classifyEmailError,
  friendlyErrorMessage,
} from "@/inngest/error-classifier";

describe("classifyEmailError", () => {
  it("treats a 5xx SMTP status embedded in the message as permanent", () => {
    // What onFailure actually sees: `responseCode` is stripped by Inngest's
    // serialization, but nodemailer appended the raw response to the message.
    expect(
      classifyEmailError({ code: "EAUTH", message: "Invalid login: 535 5.7.8 Authentication failed" }),
    ).toBe("permanent");
    expect(
      classifyEmailError({ code: "EENVELOPE", message: "Mail command failed: 550 5.7.1 Sender rejected" }),
    ).toBe("permanent");
    expect(
      classifyEmailError({ code: "EMESSAGE", message: "Message failed: 554 5.7.1 Content rejected" }),
    ).toBe("permanent");
  });

  it("treats a 4xx SMTP status embedded in the message as transient", () => {
    expect(
      classifyEmailError({ code: "EENVELOPE", message: "Recipient command failed: 451 4.7.1 Try again later" }),
    ).toBe("transient");
    expect(
      classifyEmailError({ code: "EAUTH", message: "Invalid login: 454 4.7.0 Temporary authentication failure" }),
    ).toBe("transient");
    expect(
      classifyEmailError({ code: "EMESSAGE", message: "Message failed: 450 4.7.1 Mailbox busy" }),
    ).toBe("transient");
  });

  it("uses an explicit responseCode when the raw error is still in-process", () => {
    expect(classifyEmailError({ message: "anything", responseCode: 535 })).toBe("permanent");
    expect(classifyEmailError({ message: "anything", responseCode: 421 })).toBe("transient");
  });

  it("classifies config-level nodemailer codes as permanent without a server status", () => {
    const permanentCodes = [
      "EAUTH",
      "ENOAUTH",
      "EOAUTH2",
      "ECONFIG",
      "ETLS",
      "EREQUIRETLS",
      "EPROTOCOL",
      "EDNS",
      "ENOTFOUND",
      "EENVELOPE",
      "EMAXRECIPIENTS",
      "EMESSAGE",
      "EFILEACCESS",
      "EURLACCESS",
      "EPROXY",
    ];
    for (const code of permanentCodes) {
      expect(classifyEmailError({ code, message: `boom in ${code}` }), code).toBe("permanent");
    }
  });

  it("classifies network-level nodemailer codes as transient", () => {
    const transientCodes = ["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EMAXLIMIT", "ESTREAM", "EFETCH"];
    for (const code of transientCodes) {
      expect(classifyEmailError({ code, message: `boom in ${code}` }), code).toBe("transient");
    }
  });

  it("keeps DNS resolution failures apart: wrong host is permanent, resolver blip is not", () => {
    expect(classifyEmailError({ code: "ENOTFOUND", message: "query A NOTFOUND smtp.example.com" })).toBe(
      "permanent",
    );
    expect(classifyEmailError({ code: "EDNS", message: "getaddrinfo ENOTFOUND smtp.example.com" })).toBe(
      "permanent",
    );
    expect(classifyEmailError({ code: "EAI_AGAIN", message: "query A EAI_AGAIN smtp.example.com" })).toBe(
      "transient",
    );
  });

  it("defaults unknown errors to transient so the cycle cap stays the safety net", () => {
    expect(classifyEmailError({ message: "TypeError: Cannot read properties of undefined" })).toBe(
      "transient",
    );
    expect(classifyEmailError({})).toBe("transient");
  });

  it("recovers the code from the message when StepError dropped err.code", () => {
    // What onFailure actually receives: StepError keeps only name/message/stack/cause,
    // so the failure object is codeless — the code only survives inside the text.
    expect(classifyEmailError({ message: "queryA ENOTFOUND badhostname" })).toBe("permanent");
    expect(classifyEmailError({ message: "getaddrinfo ENOTFOUND smtp.example.com" })).toBe("permanent");
    expect(classifyEmailError({ message: "queryA EAI_AGAIN smtp.example.com" })).toBe("transient");
  });

  it("prefers the message's permanent code when a codeless message carries both a known code and a transient-looking shape", () => {
    expect(classifyEmailError({ message: "connect ETIMEDOUT then ENOTFOUND" })).toBe("permanent");
  });

  it("lets an explicit err.code win over conflicting message tokens", () => {
    expect(classifyEmailError({ code: "ETIMEDOUT", message: "ETIMEDOUT wrapped as ENOTFOUND" })).toBe(
      "transient",
    );
  });

  it("treats the timeout companion's message as transient", () => {
    expect(
      classifyEmailError({ message: "The 30s execution window closed before the email was sent" }),
    ).toBe("transient");
  });
});

describe("friendlyErrorMessage", () => {
  it("explains credential failures for the dashboard", () => {
    expect(
      friendlyErrorMessage({ code: "EAUTH", message: "Invalid login: 535 5.7.8 Authentication failed" }),
    ).toContain("credentials");
  });

  it("explains DNS failures for the dashboard", () => {
    expect(friendlyErrorMessage({ code: "ENOTFOUND", message: "query A NOTFOUND smtp.brevo.com" })).toContain(
      "host",
    );
  });

  it("explains DNS failures even when StepError dropped err.code", () => {
    expect(friendlyErrorMessage({ message: "queryA ENOTFOUND badhostname" })).toContain("host");
  });

  it("explains TLS mismatches for the dashboard", () => {
    expect(friendlyErrorMessage({ code: "ETLS", message: "self signed certificate" })).toContain("port");
  });

  it("falls back to the raw provider text for unknown 5xx rejections", () => {
    const message = "Message size larger than allowed: 550 5.3.4 Message too big";
    expect(friendlyErrorMessage({ code: "EMAXRECIPIENTS", message })).toBe(
      `Your SMTP provider permanently rejected this email: ${message}`,
    );
  });

  it("falls back to the raw message when nothing matches", () => {
    expect(friendlyErrorMessage({ message: "SMTP down" })).toBe("Email delivery failed: SMTP down");
  });
});
