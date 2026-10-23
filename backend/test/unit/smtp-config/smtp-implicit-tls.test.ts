/**
 * Implicit TLS (port 465) opens its socket by hostname.
 *
 * nodemailer's default is to resolve the hostname to an IP and connect to that IP. workerd refuses
 * that for implicit TLS ("proxy request failed, cannot connect to the specified address", measured
 * against smtp.zoho.com:465 and smtp.gmail.com:465, which open fine by name), so the transport
 * hands nodemailer a socket it opened by name. These tests run that path against a real SMTP
 * server that speaks TLS from the first byte; nothing is mocked.
 */
import { type AddressInfo } from "node:net";
import { SMTPServer } from "smtp-server";
import * as nodemailer from "nodemailer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSmtpTransportOptions, checkSmtpConnection, sendTestEmail } from "@/smtp-config/smtp-connection";

const USER = "mailer@example.com";
const PASS = "s3cret-Pass-Value-98765";

describe("implicit TLS, socket opened by hostname", () => {
  let server: SMTPServer;
  let port: number;
  const received: { from: string; to: string[]; secure: boolean }[] = [];

  beforeAll(async () => {
    // `secure: true` = TLS from the first byte, like port 465. `smtp-server` brings its own
    // self-signed certificate, so no key material lives in this repository.
    server = new SMTPServer({
      secure: true,
      authOptional: false,
      onAuth(auth, _session, callback) {
        if (auth.username === USER && auth.password === PASS) return callback(null, { user: auth.username });
        return callback(new Error("Invalid login"));
      },
      onData(stream, session, callback) {
        stream.on("data", () => undefined);
        stream.on("end", () => {
          received.push({
            from: session.envelope.mailFrom ? session.envelope.mailFrom.address : "",
            to: session.envelope.rcptTo.map((r) => r.address),
            secure: session.secure,
          });
          callback();
        });
      },
    });
    // The client aborting the handshake on an untrusted certificate is expected, not a failure.
    server.on("error", () => undefined);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const cfg = (extra: Partial<{ smtpHostName: string; smtpPassword: string }> = {}) => ({
    smtpHostName: "localhost",
    smtpUsername: USER,
    smtpPassword: PASS,
    smtpPort: port,
    smtpSecurity: "tls" as const,
    senderEmail: USER,
    ...extra,
  });

  it("the transport options carry a getSocket: nodemailer is not left to resolve the name to an IP", () => {
    expect(typeof buildSmtpTransportOptions(cfg()).getSocket).toBe("function");
    expect(typeof buildSmtpTransportOptions({ ...cfg(), smtpSecurity: "starttls" }).getSocket).toBe("function");
  });

  it("the check passes and authenticates over implicit TLS, addressed by name", async () => {
    expect(await checkSmtpConnection(cfg(), { rejectUnauthorized: false })).toEqual({ ok: true });
  });

  it("a real send arrives over implicit TLS, addressed by name", async () => {
    const transporter = nodemailer.createTransport(buildSmtpTransportOptions(cfg(), { rejectUnauthorized: false }));
    try {
      await transporter.sendMail({ from: USER, to: "dest@example.com", subject: "Hello", text: "0123456789" });
    } finally {
      transporter.close();
    }
    expect(received.at(-1)).toMatchObject({ from: USER, to: ["dest@example.com"], secure: true });
  });

  it("the test send goes through the same path", async () => {
    const result = await sendTestEmail(cfg(), { to: "dest@example.com", subject: "Probe", text: "x" }, { rejectUnauthorized: false });
    expect(result.ok).toBe(true);
  });

  it("the certificate is still verified against the hostname (verification stays on by default)", async () => {
    const result = await checkSmtpConnection(cfg());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("certificate");
  });

  it("wrong credentials are still reported as authentication, with no secret in the message", async () => {
    const result = await checkSmtpConnection(cfg({ smtpPassword: "WRONG-PASSWORD-xyz" }), { rejectUnauthorized: false });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("authentication");
      expect(JSON.stringify(result)).not.toContain("WRONG-PASSWORD-xyz");
    }
  });

  it("a connection that fails before the greeting is a value, not a throw, and is bounded", async () => {
    const started = Date.now();
    // Nothing listens here: the failure is the socket's own, surfaced through getSocket.
    const result = await checkSmtpConnection({ ...cfg(), smtpPort: 1 }, { rejectUnauthorized: false });
    expect(result.ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(15_000);
  });
});
