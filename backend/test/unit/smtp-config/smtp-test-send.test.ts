/**
 * The manual test send, against a real SMTP server (`smtp-server`) on a random local port.
 * Nothing here mocks nodemailer or the socket.
 *
 *  T1  A send through a correct configuration arrives, authenticated, from the configuration's sender.
 *  T2  A refused message (sender or recipient) is not "unknown": it is named, with the server's own words.
 *  T3  Wrong credentials, a dead port and a wrong TLS mode keep the names the connection check gives them.
 *  T4  A secret never leaves: not in the answer, whatever the server replies.
 *  T5  The DTO: only a valid recipient is required, the rest has defaults, unknown fields are refused.
 *  T6  A file attached in the dashboard reaches the server as a MIME attachment, with its name, its
 *      type and its exact bytes; the DTO takes the same `attachments` as POST /send-email.
 */
import { SMTPServer } from "smtp-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_SUBJECT_LENGTH } from "@/core/validation";
import { TestSendDto } from "@/smtp-config/smtp-config.dto";
import { classifySmtpError, sendTestEmail } from "@/smtp-config/smtp-connection";

const USER = "mailer@example.com";
const PASS = "s3cret-Pass-Value-98765";
const SENDER = "sender@example.com";

interface Running {
  server: SMTPServer;
  port: number;
  received: { from: string; to: string[]; authUser: string | undefined; secure: boolean; body: string }[];
  close: () => Promise<void>;
}

/** An SMTP server that accepts the right login and refuses one sender and one recipient. */
async function smtp(): Promise<Running> {
  const received: Running["received"] = [];
  const server = new SMTPServer({
    authOptional: false,
    onAuth(auth, _session, callback) {
      if (auth.username === USER && auth.password === PASS) return callback(null, { user: auth.username });
      return callback(new Error("Invalid login"));
    },
    onMailFrom(address, _session, callback) {
      if (address.address === "forbidden@example.com") {
        return callback(Object.assign(new Error("550 5.7.1 Sender address rejected: not owned by user"), { responseCode: 550 }));
      }
      return callback();
    },
    onRcptTo(address, _session, callback) {
      if (address.address === "nobody@example.com") {
        return callback(Object.assign(new Error("550 5.1.1 Recipient address rejected: user unknown"), { responseCode: 550 }));
      }
      return callback();
    },
    onData(stream, session, callback) {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => {
        received.push({
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : "",
          to: session.envelope.rcptTo.map((r) => r.address),
          authUser: session.user as string | undefined,
          secure: session.secure,
          body: Buffer.concat(chunks).toString("utf8"),
        });
        callback();
      });
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { server, port, received, close: () => new Promise<void>((r) => server.close(() => r())) };
}

describe("manual test send, against a real SMTP server", () => {
  let running: Running;
  beforeAll(async () => {
    running = await smtp();
  });
  afterAll(async () => {
    await running.close();
  });

  const cfg = (extra: Partial<{ smtpPassword: string; senderEmail: string; smtpPort: number; smtpSecurity: "tls" | "starttls" }> = {}) => ({
    smtpHostName: "127.0.0.1",
    smtpUsername: USER,
    smtpPassword: PASS,
    smtpPort: running.port,
    smtpSecurity: "starttls" as const,
    senderEmail: SENDER,
    ...extra,
  });
  const mail = { to: "dest@example.com", subject: "Hello from the test", text: "A test message body." };

  it("T1 arrives, authenticated over TLS, from the configuration's sender, with the typed subject and text", async () => {
    const r = await sendTestEmail(cfg(), mail, { rejectUnauthorized: false });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.messageId).toBeTruthy();
    expect(running.received.at(-1)).toMatchObject({ from: SENDER, to: ["dest@example.com"], authUser: USER, secure: true });
    expect(running.received.at(-1)?.body).toContain("Hello from the test");
    expect(running.received.at(-1)?.body).toContain("A test message body.");
  });

  it("T6 an attached file arrives as a MIME part: name, type and exact bytes", async () => {
    const bytes = Uint8Array.from({ length: 600 }, (_, i) => i % 256);
    const r = await sendTestEmail(
      cfg(),
      { ...mail, attachments: [{ filename: "recu.pdf", contentType: "application/pdf", content: bytes }] },
      { rejectUnauthorized: false },
    );
    expect(r.ok).toBe(true);
    const raw = running.received.at(-1)?.body ?? "";
    const part = raw.split(/--[^\r\n]+/).find((p) => /content-disposition:\s*attachment/i.test(p)) ?? "";
    expect(part).toMatch(/content-type:\s*application\/pdf/i);
    expect(part).toMatch(/filename="?recu\.pdf"?/i);
    const body = part.slice(part.search(/\r?\n\r?\n/)).replace(/\s+/g, "");
    expect(new Uint8Array(Buffer.from(body, "base64"))).toEqual(bytes);
  });

  it("T6 without attachments, the message has no attachment part", async () => {
    const r = await sendTestEmail(cfg(), mail, { rejectUnauthorized: false });
    expect(r.ok).toBe(true);
    expect(running.received.at(-1)?.body).not.toMatch(/content-disposition:\s*attachment/i);
  });

  it("T2 a refused sender is named `rejected`, with the server's words and the fix", async () => {
    const before = running.received.length;
    const r = await sendTestEmail(cfg({ senderEmail: "forbidden@example.com" }), mail, { rejectUnauthorized: false });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("rejected");
      expect(r.message).toMatch(/Sender address rejected/);
      expect(r.message).toMatch(/sender address is allowed/);
    }
    expect(running.received.length, "a refused message is not delivered").toBe(before);
  });

  it("T2 a refused recipient is named `rejected` too", async () => {
    const r = await sendTestEmail(cfg(), { ...mail, to: "nobody@example.com" }, { rejectUnauthorized: false });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("rejected");
      expect(r.message).toMatch(/Recipient address rejected/);
    }
  });

  it("T3 wrong credentials: authentication, as in the connection check", async () => {
    const r = await sendTestEmail(cfg({ smtpPassword: "WRONG-PASSWORD-xyz" }), mail, { rejectUnauthorized: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("authentication");
  });

  it("T3 implicit TLS on a port that does not speak it: a mode mismatch", async () => {
    const r = await sendTestEmail(cfg({ smtpSecurity: "tls" }), mail, { rejectUnauthorized: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("tls_mismatch");
  });

  it("T3 a certificate that does not verify is named (verification is on by default)", async () => {
    const r = await sendTestEmail(cfg(), mail);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("certificate");
  });

  it("T4 neither the password nor the user name is in any answer", async () => {
    const answers = await Promise.all([
      sendTestEmail(cfg({ smtpPassword: "WRONG-PASSWORD-xyz" }), mail, { rejectUnauthorized: false }),
      sendTestEmail(cfg({ senderEmail: "forbidden@example.com" }), mail, { rejectUnauthorized: false }),
      sendTestEmail(cfg(), mail, { rejectUnauthorized: false }),
    ]);
    for (const answer of answers) {
      const text = JSON.stringify(answer);
      expect(text).not.toContain("WRONG-PASSWORD-xyz");
      expect(text).not.toContain(PASS);
      expect(text).not.toContain(USER);
    }
  });
});

describe("T2 the refusal is told apart from the rest", () => {
  it("an envelope or message error is `rejected`; a bare 5xx reply too; an unknown error is not", () => {
    expect(classifySmtpError(Object.assign(new Error("x"), { code: "EENVELOPE", response: "550 no" }), "tls", 465).reason).toBe("rejected");
    expect(classifySmtpError(Object.assign(new Error("x"), { code: "EMESSAGE", responseCode: 554 }), "tls", 465).reason).toBe("rejected");
    expect(classifySmtpError(Object.assign(new Error("x"), { responseCode: 553 }), "tls", 465).reason).toBe("rejected");
    expect(classifySmtpError(new Error("something odd"), "tls", 465).reason).toBe("unknown");
  });

  it("the server's reply is one bounded line, with no control characters", () => {
    const reply = `550 5.7.1 nope\r\n${"x".repeat(400)}`;
    const r = classifySmtpError(Object.assign(new Error("x"), { code: "EENVELOPE", response: reply }), "tls", 465);
    expect(r.message).not.toMatch(/[\r\n]/);
    expect(r.message.length).toBeLessThan(500);
  });

  it("authentication still wins over rejected (535 is a login, not a message)", () => {
    expect(classifySmtpError(Object.assign(new Error("x"), { responseCode: 535 }), "tls", 465).reason).toBe("authentication");
  });
});

describe("T5 the DTO", () => {
  it("needs only a valid recipient: subject and text have defaults", () => {
    const parsed = TestSendDto.parse({ to: " dest@example.com " });
    expect(parsed.to).toBe("dest@example.com");
    expect(parsed.subject.length).toBeGreaterThanOrEqual(3);
    expect(parsed.text.length).toBeGreaterThan(0);
  });

  it("refuses a bad recipient, an empty text, a too long subject, and unknown fields (no `from`, no `html`)", () => {
    expect(TestSendDto.safeParse({ to: "not-an-email" }).success).toBe(false);
    expect(TestSendDto.safeParse({ to: "a@b.co", text: "   " }).success).toBe(false);
    expect(TestSendDto.safeParse({ to: "a@b.co", subject: "x".repeat(MAX_SUBJECT_LENGTH + 1) }).success).toBe(false);
    expect(TestSendDto.safeParse({ to: "a@b.co", from: "someone@else.com" }).success).toBe(false);
    expect(TestSendDto.safeParse({ to: "a@b.co", html: "<b>x</b>" }).success).toBe(false);
  });

  it("T6 takes the same attachments as POST /send-email, and refuses the same bad ones", () => {
    const ok = { filename: "a.pdf", content: Buffer.from("%PDF-1.4").toString("base64"), content_type: "application/pdf" };
    expect(TestSendDto.safeParse({ to: "a@b.co", attachments: [ok] }).success).toBe(true);
    expect(TestSendDto.safeParse({ to: "a@b.co", attachments: [{ ...ok, content: "not base64!!" }] }).success).toBe(false);
    expect(TestSendDto.safeParse({ to: "a@b.co", attachments: [{ ...ok, filename: "a.pdf\r\nBcc: x@y.z" }] }).success).toBe(false);
    expect(TestSendDto.safeParse({ to: "a@b.co", attachments: Array.from({ length: 6 }, () => ok) }).success).toBe(false);
  });
});
