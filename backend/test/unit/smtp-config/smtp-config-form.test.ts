/**
 * The SMTP configuration form's backend, against real sockets.
 *
 * A real SMTP server (`smtp-server`) listens on a random local port, with and without
 * TLS, with and without STARTTLS; the connection check and the sending transport talk
 * to it for real. Nothing here mocks nodemailer, the socket, or the check.
 *
 * ── Failure analysis (written before the code) ──
 *  S1  A hostname that cannot be one is stored (`https://smtp.zoho.com`, a port glued
 *      on, a trailing space, an underscore) and only fails 30 s later, four times, in
 *      the background, with a runtime sentence that names nothing.
 *  S2  The port was a global `PORT` binding: two configurations could not use two ports,
 *      and a provider on 587 (STARTTLS) cannot be configured at all.
 *  S3  `secure` is hard-coded to `true`: a STARTTLS provider fails with a TLS error
 *      that does not say "wrong mode".
 *  S4  STARTTLS configured but the server does not offer it: the password would be
 *      sent in clear. It must fail instead (`requireTLS`).
 *  S5  A failed connection is reported as the runtime's own sentence ("proxy request
 *      failed...") instead of what to fix: unknown host, nothing listening, wrong TLS
 *      mode, bad certificate, bad credentials, no answer.
 *  S6  The check sends a mail, or hangs for a minute on a server that never answers.
 *  S7  A secret leaks: the password in an error message, in a log line, or back to the
 *      browser in the check's answer.
 *  S8  A row written before the port columns existed stops working (it must keep the
 *      global port and implicit TLS, exactly as it did).
 *  S9  Changing the port leaves the old security: 465 -> 587 with `tls` never connects.
 *  S10 Port 25 is accepted, stored, and fails on every send (Workers block it).
 *
 * The run writes `test/artifacts/smtp-config-form.json`, committed, compared by CI.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo, type Server as NetServer, type Socket } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SMTPServer } from "smtp-server";
import * as nodemailer from "nodemailer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CreateSmtpConfigDto, UpdateSmtpConfigDto } from "@/smtp-config/smtp-config.dto";
import { buildSmtpTransportOptions, checkSmtpConnection, classifySmtpError } from "@/smtp-config/smtp-connection";
import { SMTP_PORTS, defaultSecurityFor, parseSmtpHostname } from "@/smtp-config/smtp-host";

const here = dirname(fileURLToPath(import.meta.url));
const report: Record<string, unknown> = {};

const USER = "mailer@example.com";
const PASS = "s3cret-Pass-Value-98765";

// `smtp-server` brings its own self-signed certificate: no key material lives in this repository.

interface Running {
  server: SMTPServer;
  port: number;
  received: { from: string; to: string[]; authUser: string | undefined; secure: boolean }[];
  authAttempts: { user: string; secure: boolean }[];
  close: () => Promise<void>;
}

/** An SMTP server on a random local port. `starttls: false` removes the STARTTLS capability. */
async function smtp(options: { starttls: boolean }): Promise<Running> {
  const received: Running["received"] = [];
  const authAttempts: Running["authAttempts"] = [];
  const server = new SMTPServer({
    authOptional: false,
    allowInsecureAuth: !options.starttls ? true : false,
    disabledCommands: options.starttls ? [] : ["STARTTLS"],
    onAuth(auth, session, callback) {
      authAttempts.push({ user: auth.username ?? "", secure: session.secure });
      if (auth.username === USER && auth.password === PASS) return callback(null, { user: auth.username });
      return callback(new Error("Invalid login"));
    },
    onData(stream, session, callback) {
      stream.on("data", () => undefined);
      stream.on("end", () => {
        received.push({
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : "",
          to: session.envelope.rcptTo.map((r) => r.address),
          authUser: session.user as string | undefined,
          secure: session.secure,
        });
        callback();
      });
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { server, port, received, authAttempts, close: () => new Promise<void>((r) => server.close(() => r())) };
}

/** A server that accepts the TCP connection and never says a word (a black hole). */
async function silent(): Promise<{ port: number; close: () => Promise<void> }> {
  const sockets = new Set<Socket>();
  const server: NetServer = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

/** A port nothing listens on: bind, read the number, close. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

const base = { smtpUsername: USER, smtpPassword: PASS };

describe("S1 the hostname is checked when typed, not 30 seconds later in the background", () => {
  const refused: [string, RegExp][] = [
    ["https://smtp.zoho.com", /without "https:\/\/"/],
    ["ssl://smtp.zoho.com", /without "ssl:\/\//],
    ["smtp.zoho.com:465", /Use the Port field|port/i],
    ["smtp zoho.com", /spaces/],
    ["smtp_zoho.com", /character/],
    ["smtp.zoho.com/mail", /no path/],
    ["user@smtp.zoho.com", /no user name/],
    ["smtp", /full server name/],
    ["127.0.0.1", /private or local/],
    ["10.0.0.5", /private or local/],
    ["192.168.1.10", /private or local/],
    ["169.254.169.254", /private or local/],
    ["999.1.1.1", /not a valid IP/],
    ["-bad.example.com", /character/],
    ["a..example.com", /character/],
    ["", /required/],
  ];

  it.each(refused)("refuses %j with a reason that says what to fix", (value, reason) => {
    const checked = parseSmtpHostname(value);
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.message).toMatch(reason);
  });

  it("accepts and normalises real hostnames (case, one trailing dot, an IP that is public)", () => {
    expect(parseSmtpHostname("smtp.zoho.com")).toEqual({ ok: true, hostname: "smtp.zoho.com" });
    expect(parseSmtpHostname("  SMTP.Zoho.EU.  ")).toEqual({ ok: true, hostname: "smtp.zoho.eu" });
    expect(parseSmtpHostname("smtppro.zoho.com")).toEqual({ ok: true, hostname: "smtppro.zoho.com" });
    expect(parseSmtpHostname("89.36.170.164")).toEqual({ ok: true, hostname: "89.36.170.164" });
    expect(parseSmtpHostname("in-v3.mailjet.com").ok).toBe(true);
  });

  it("is enforced by the DTO the controller validates with, on create and on update", () => {
    const create = CreateSmtpConfigDto.safeParse({ ...base, smtpHostname: "https://smtp.zoho.com", senderEmail: "no-reply@getitaja.com" });
    expect(create.success).toBe(false);
    const update = UpdateSmtpConfigDto.safeParse({ smtpHostname: "smtp.zoho.com:465" });
    expect(update.success).toBe(false);
    const ok = CreateSmtpConfigDto.parse({ ...base, smtpHostname: " SMTP.ZOHO.COM ", senderEmail: "no-reply@getitaja.com" });
    expect(ok.smtpHostname).toBe("smtp.zoho.com");
    report.hostnameRefused = refused.map(([v]) => v);
  });
});

describe("S2/S9/S10 the port and the security are part of the configuration", () => {
  it("defaults to 465 with implicit TLS, which is what every row did before", () => {
    const dto = CreateSmtpConfigDto.parse({ ...base, smtpHostname: "smtp.zoho.com", senderEmail: "a@b.co" });
    expect(dto.smtpPort).toBe(465);
    expect(dto.smtpSecurity).toBe("tls");
  });

  it("587 with no security stated is STARTTLS; 2525 too; 2465 is TLS", () => {
    const sec = (port: number) => CreateSmtpConfigDto.parse({ ...base, smtpHostname: "smtp.zoho.com", senderEmail: "a@b.co", smtpPort: port }).smtpSecurity;
    expect(sec(587)).toBe("starttls");
    expect(sec(2525)).toBe("starttls");
    expect(sec(2465)).toBe("tls");
    expect(defaultSecurityFor(465)).toBe("tls");
  });

  it("an explicit security is kept, whatever the port", () => {
    const dto = CreateSmtpConfigDto.parse({ ...base, smtpHostname: "smtp.zoho.com", senderEmail: "a@b.co", smtpPort: 587, smtpSecurity: "tls" });
    expect(dto.smtpSecurity).toBe("tls");
  });

  it("refuses port 25 (blocked outbound on Workers), 0, 70000, a float and a string, with the allowed list", () => {
    for (const port of [25, 0, 70000, 465.5, "465" as unknown as number, 80, 22]) {
      const r = CreateSmtpConfigDto.safeParse({ ...base, smtpHostname: "smtp.zoho.com", senderEmail: "a@b.co", smtpPort: port });
      expect(r.success, String(port)).toBe(false);
    }
    const r = CreateSmtpConfigDto.safeParse({ ...base, smtpHostname: "smtp.zoho.com", senderEmail: "a@b.co", smtpPort: 25 });
    if (!r.success) expect(JSON.stringify(r.error.issues)).toContain("Port 25 is blocked");
    expect(SMTP_PORTS).not.toContain(25);
  });

  it("refuses an unknown security and unknown fields (the schema stays strict)", () => {
    expect(CreateSmtpConfigDto.safeParse({ ...base, smtpHostname: "smtp.zoho.com", senderEmail: "a@b.co", smtpSecurity: "ssl" }).success).toBe(false);
    expect(CreateSmtpConfigDto.safeParse({ ...base, smtpHostname: "smtp.zoho.com", senderEmail: "a@b.co", rejectUnauthorized: false }).success).toBe(false);
  });
});

describe("S3/S4/S8 the transport options", () => {
  it("tls -> secure, no requireTLS; starttls -> not secure, requireTLS", () => {
    const tls = buildSmtpTransportOptions({ smtpHostName: "h.example.com", ...base, smtpPort: 465, smtpSecurity: "tls" });
    expect([tls.secure, tls.requireTLS, tls.port]).toEqual([true, false, 465]);
    const st = buildSmtpTransportOptions({ smtpHostName: "h.example.com", ...base, smtpPort: 587, smtpSecurity: "starttls" });
    expect([st.secure, st.requireTLS, st.port]).toEqual([false, true, 587]);
  });

  it("certificate verification is on, IPv4 is forced, and every timeout is bounded", () => {
    const o = buildSmtpTransportOptions({ smtpHostName: "h.example.com", ...base, smtpPort: 465, smtpSecurity: "tls" });
    expect(o.tls.rejectUnauthorized).toBe(true);
    expect(o.family).toBe(4);
    expect(o.connectionTimeout).toBeLessThanOrEqual(10_000);
    expect(o.greetingTimeout).toBeLessThanOrEqual(10_000);
    expect(o.socketTimeout).toBeLessThanOrEqual(20_000);
  });

  it("a row from before the columns existed keeps implicit TLS on 465, with no environment variable involved", () => {
    const legacy = buildSmtpTransportOptions({ smtpHostName: "h.example.com", ...base });
    expect([legacy.port, legacy.secure, legacy.requireTLS]).toEqual([465, true, false]);
  });
});

describe("S3/S4/S5/S6 against a real SMTP server", () => {
  let plain: Running;
  let noStarttls: Running;
  let black: Awaited<ReturnType<typeof silent>>;

  beforeAll(async () => {
    plain = await smtp({ starttls: true });
    noStarttls = await smtp({ starttls: false });
    black = await silent();
  });
  afterAll(async () => {
    await plain.close();
    await noStarttls.close();
    await black.close();
  });

  const cfg = (port: number, security: "tls" | "starttls", extra: Partial<{ smtpUsername: string; smtpPassword: string; smtpHostName: string }> = {}) => ({
    smtpHostName: "127.0.0.1",
    smtpUsername: USER,
    smtpPassword: PASS,
    smtpPort: port,
    smtpSecurity: security,
    ...extra,
  });

  it("STARTTLS on the right mode: the check passes, authenticates over TLS, and sends no mail", async () => {
    const before = plain.received.length;
    const r = await checkSmtpConnection(cfg(plain.port, "starttls"), { rejectUnauthorized: false });
    expect(r).toEqual({ ok: true });
    expect(plain.received.length, "the check must not send a message").toBe(before);
    expect(plain.authAttempts.at(-1)).toEqual({ user: USER, secure: true });
    report.starttlsCheck = "ok, authenticated over TLS, nothing sent";
  });

  it("a real send through STARTTLS arrives, authenticated, over TLS", async () => {
    const transporter = nodemailer.createTransport(buildSmtpTransportOptions(cfg(plain.port, "starttls"), { rejectUnauthorized: false }));
    await transporter.sendMail({ from: USER, to: "dest@example.com", subject: "Hello", text: "0123456789" });
    transporter.close();
    expect(plain.received.at(-1)).toMatchObject({ from: USER, to: ["dest@example.com"], authUser: USER, secure: true });
  });

  it("S4 STARTTLS configured, server without STARTTLS: refused, the password never sent in clear", async () => {
    const before = noStarttls.authAttempts.length;
    const r = await checkSmtpConnection(cfg(noStarttls.port, "starttls"), { rejectUnauthorized: false });
    expect(r.ok).toBe(false);
    expect(noStarttls.authAttempts.length, "no AUTH may be attempted on a clear connection").toBe(before);
    if (!r.ok) expect(r.reason).toBe("starttls_unavailable");
  });

  it("S3 implicit TLS against a port that does not speak TLS: named as a mode mismatch, with the fix", async () => {
    const r = await checkSmtpConnection(cfg(plain.port, "tls"), { rejectUnauthorized: false });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("tls_mismatch");
      expect(r.message).toMatch(/starttls/);
    }
  });

  it("S5 wrong credentials: authentication, and the message names neither the user nor the password", async () => {
    const r = await checkSmtpConnection(cfg(plain.port, "starttls", { smtpPassword: "WRONG-PASSWORD-xyz" }), { rejectUnauthorized: false });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("authentication");
      expect(JSON.stringify(r)).not.toContain("WRONG-PASSWORD-xyz");
      expect(JSON.stringify(r)).not.toContain(USER);
    }
  });

  it("S5 nothing listens on the port: connection refused, naming the port", async () => {
    const port = await freePort();
    const r = await checkSmtpConnection(cfg(port, "starttls"), { rejectUnauthorized: false });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("connection_refused");
      expect(r.message).toContain(String(port));
    }
  });

  it("S5 a server name that does not exist: host_not_found", async () => {
    const r = await checkSmtpConnection(cfg(587, "starttls", { smtpHostName: "no-such-host.invalid" }), { rejectUnauthorized: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(["host_not_found", "cannot_connect"]).toContain(r.reason);
  });

  it("S6 a server that never answers is abandoned within the bound, not after a minute", async () => {
    const started = Date.now();
    const r = await checkSmtpConnection(cfg(black.port, "starttls"), { rejectUnauthorized: false });
    const took = Date.now() - started;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("connection_timeout");
    expect(took).toBeLessThan(15_000);
    report.blackHoleAbandonedUnderMs = 15_000;
  }, 30_000);

  it("S5 a certificate that does not verify is named (verification is on by default)", async () => {
    const r = await checkSmtpConnection(cfg(plain.port, "starttls"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("certificate");
  });
});

describe("S5 the runtime's own wording and the error codes map to a fix", () => {
  const cases: [string, unknown, "tls" | "starttls", string][] = [
    ["workerd refusal", new Error("proxy request failed, cannot connect to the specified address"), "tls", "cannot_connect"],
    ["EAUTH", Object.assign(new Error("Invalid login"), { code: "EAUTH", responseCode: 535 }), "starttls", "authentication"],
    ["ECONNREFUSED", Object.assign(new Error("x"), { code: "ECONNREFUSED" }), "tls", "connection_refused"],
    ["ENOTFOUND", Object.assign(new Error("x"), { code: "ENOTFOUND" }), "tls", "host_not_found"],
    ["ETIMEDOUT", Object.assign(new Error("x"), { code: "ETIMEDOUT" }), "tls", "connection_timeout"],
    // nodemailer wraps socket failures as ESOCKET and keeps the errno name in the message: found by a real refused connection
    ["wrapped ECONNREFUSED", Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:587"), { code: "ESOCKET" }), "starttls", "connection_refused"],
    ["wrapped ENOTFOUND", Object.assign(new Error("getaddrinfo ENOTFOUND smtp.nope.example"), { code: "ESOCKET" }), "tls", "host_not_found"],
    ["wrapped ETIMEDOUT", Object.assign(new Error("connect ETIMEDOUT 10.1.1.1:465"), { code: "ESOCKET" }), "tls", "connection_timeout"],
    ["TLS on a plain port", new Error("error:0A00010B:SSL routines::wrong version number"), "tls", "tls_mismatch"],
    ["certificate", new Error("Hostname/IP does not match certificate's altnames"), "tls", "certificate"],
    ["no STARTTLS", new Error("Message failed: STARTTLS not supported"), "starttls", "starttls_unavailable"],
    ["anything else", new Error("something odd"), "tls", "unknown"],
  ];
  it.each(cases)("%s -> %s", (_name, err, security, reason) => {
    expect(classifySmtpError(err, security, 465).reason).toBe(reason);
  });

  it("the workerd sentence names the port that failed, and only mentions the port 25 block when it is port 25", () => {
    const refusal = new Error("proxy request failed, cannot connect to the specified address");
    const on465 = classifySmtpError(refusal, "tls", 465);
    expect(on465.message).toMatch(/hostname and the port/);
    expect(on465.message).toContain("465");
    expect(on465.message, "a person on 465 must not be told to look at port 25").not.toMatch(/port 25/);
    expect(classifySmtpError(refusal, "tls", 25).message).toMatch(/port 25 is blocked/);
  });
});

describe("S7 a secret never leaves", () => {
  it("no classified message contains the password, whatever the error carries", () => {
    const secret = "TOP-SECRET-PASSWORD-123";
    for (const err of [
      new Error(`Invalid login: 535 5.7.8 for ${secret}`),
      Object.assign(new Error(`AUTH PLAIN ${secret}`), { code: "EAUTH" }),
      new Error(`connect failed ${secret}`),
    ]) {
      expect(JSON.stringify(classifySmtpError(err, "tls", 465))).not.toContain(secret);
    }
  });
});

afterAll(() => {
  const dir = join(here, "../../artifacts");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "smtp-config-form.json"), `${JSON.stringify(report, null, 2)}\n`);
});
