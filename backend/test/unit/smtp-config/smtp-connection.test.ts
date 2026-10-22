import { describe, it, expect } from "vitest";
import {
  buildSmtpTransportOptions,
  classifySmtpError,
  SMTP_CONNECTION_TIMEOUT_MS,
  SMTP_GREETING_TIMEOUT_MS,
  SMTP_SOCKET_TIMEOUT_MS,
} from "@/smtp-config/smtp-connection";
import {
  DEFAULT_SMTP_PORT,
  SMTP_PORTS,
  defaultSecurityFor,
  isAllowedSmtpPort,
  parseSmtpHostname,
} from "@/smtp-config/smtp-host";

const smtp = {
  smtpHostName: "smtp.example.com",
  smtpPort: 587,
  smtpSecurity: "starttls" as const,
  smtpUsername: "user@example.com",
  smtpPassword: "secret",
  senderEmail: "sender@example.com",
};

describe("parseSmtpHostname", () => {
  it.each([
    ["smtp.zoho.com", "smtp.zoho.com"],
    [" SMTP.Example.COM. ", "smtp.example.com"],
    ["192.0.2.10", "192.0.2.10"],
  ])("accepts and normalises %s", (input, expected) => {
    expect(parseSmtpHostname(input)).toEqual({ ok: true, hostname: expected });
  });

  it.each([
    ["", "required"],
    ["smtp zoho.com", "spaces"],
    ["https://smtp.zoho.com", "without"],
    ["smtp.zoho.com:465", "Port field"],
    ["smtp.zoho.com/path", "server name"],
    ["localhost", "full server name"],
    ["smtp_underscore.example.com", "character"],
    ["127.0.0.1", "private or local"],
    ["10.0.0.1", "private or local"],
    ["999.0.0.1", "valid IP"],
  ])("refuses %j with a useful reason", (input, reason) => {
    const result = parseSmtpHostname(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(new RegExp(reason, "i"));
  });
});

describe("SMTP port and security", () => {
  it("accepts only the ports a Worker can use", () => {
    expect(SMTP_PORTS).not.toContain(25);
    for (const port of SMTP_PORTS) expect(isAllowedSmtpPort(port)).toBe(true);
    expect(isAllowedSmtpPort(25)).toBe(false);
    expect(isAllowedSmtpPort(1234)).toBe(false);
  });

  it("defaults implicit TLS on 465/2465 and STARTTLS elsewhere", () => {
    expect(defaultSecurityFor(465)).toBe("tls");
    expect(defaultSecurityFor(2465)).toBe("tls");
    expect(defaultSecurityFor(587)).toBe("starttls");
    expect(defaultSecurityFor(2525)).toBe("starttls");
  });
});

describe("buildSmtpTransportOptions", () => {
  it("uses the configuration port and STARTTLS settings", () => {
    const options = buildSmtpTransportOptions(smtp);

    expect(options).toMatchObject({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: "user@example.com", pass: "secret" },
      family: 4,
      tls: { rejectUnauthorized: true },
      connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
      greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
      socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
    });
    expect(options.getSocket).toBeTypeOf("function");
  });

  it("uses implicit TLS from the first byte on 465", () => {
    const options = buildSmtpTransportOptions({
      ...smtp,
      smtpPort: 465,
      smtpSecurity: "tls",
    });

    expect(options.secure).toBe(true);
    expect(options.requireTLS).toBe(false);
  });

  it("falls back to 465/implicit TLS for rows that predate the columns", () => {
    const options = buildSmtpTransportOptions({
      ...smtp,
      smtpPort: undefined,
      smtpSecurity: undefined,
    });

    expect(options.port).toBe(DEFAULT_SMTP_PORT);
    expect(options.secure).toBe(true);
    expect(options.requireTLS).toBe(false);
  });

  it("can disable certificate verification for local test servers only", () => {
    const options = buildSmtpTransportOptions(smtp, { rejectUnauthorized: false });
    expect(options.tls.rejectUnauthorized).toBe(false);
  });
});

describe("classifySmtpError", () => {
  it.each([
    [{ code: "EAUTH" }, "authentication"],
    [{ code: "ENOTFOUND" }, "host_not_found"],
    [{ code: "ECONNREFUSED" }, "connection_refused"],
    [{ code: "ETIMEDOUT" }, "connection_timeout"],
    [{ message: "write EPROTO wrong version number" }, "tls_mismatch"],
    [{ message: "self signed certificate" }, "certificate"],
    [{ message: "STARTTLS not supported" }, "starttls_unavailable"],
    [{ message: "proxy request failed, cannot connect to the specified address" }, "cannot_connect"],
    [{ responseCode: 550, response: "5.1.1 recipient rejected" }, "rejected"],
  ])("maps %j to %s", (error, reason) => {
    const result = classifySmtpError(error, "starttls", 587);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe(reason);
      expect(result.message).not.toContain("secret");
    }
  });

  it("explains a TLS mode mismatch using the selected mode and port", () => {
    const result = classifySmtpError(new Error("wrong version number"), "tls", 465);
    expect(result).toMatchObject({ ok: false, reason: "tls_mismatch" });
    if (!result.ok) expect(result.message).toContain("starttls");
  });
});
