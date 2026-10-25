/**
 * `reply_to` and `headers` on POST /send-email, end to end: the real route and validation, the
 * real D1 (Miniflare, every migration), the loader the workflow uses, and nodemailer against a
 * real SMTP server (`smtp-server`) on a random port.
 *
 *  H1  The Reply-To and the custom headers reach the SMTP server as written (canonical names).
 *  H2  Neither sits in clear in D1, and the key rotation knows both columns.
 *  H3  A message without them keeps its exact shape (no empty `headers: {}` / `replyTo`).
 *  H4  A templated send keeps them while rendering to the inline shape.
 *  H5  A header that could inject another header, or that the transport owns, is refused (400).
 */
import { SMTPServer } from "smtp-server";
import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Miniflare } from "miniflare";
import { eq } from "drizzle-orm";
import { errorHandler } from "@/middleware/error.handler";
import { createSendEmailController } from "@/send-email/send-email.controller";
import { SendEmailRepository } from "@/send-email/send-email.repository";
import { loadEmailForSending } from "@/send-email/send-email.loader";
import { CloudflareEmailTransport } from "@/send-email/cloudflare-email.transport";
import { SmtpEmailTransport } from "@/transports";
import { TemplateRepository } from "@/templates/templates.repository";
import { createDatabase } from "@/db/connection";
import { apikey, emailContents, user } from "@/db/schema";
import { ENCRYPTED_COLUMNS } from "@/key-rotation/key-rotation.repository";
import { createTestD1, cleanupTestD1 } from "../helpers/d1-setup";
import type { Bindings, UserInfoVariables } from "@/index";
import type { SendEmailQueueMessage } from "@/send-email/send-email.types";

const AES_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const base = {
  to: "buyer@example.com",
  subject: "Votre reçu REC-1",
  text: "Votre paiement est confirmé. Merci.",
  html: "<p>Votre paiement est confirmé.</p>",
};

const unsubscribe = {
  "list-unsubscribe": "<https://shop.example.com/u/abc>, <mailto:unsubscribe@example.com>",
  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  "x-campaign-id": "receipts-2026",
};

/** Unfolded header block of a raw message, keyed by lower-case name. */
function headerBlock(raw: string): Map<string, string> {
  const block = raw.slice(0, raw.search(/\r?\n\r?\n/)).replace(/\r?\n[ \t]+/g, " ");
  const headers = new Map<string, string>();
  for (const line of block.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon > 0) headers.set(line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim());
  }
  return headers;
}

async function smtpServer() {
  const received: Map<string, string>[] = [];
  const server = new SMTPServer({
    onAuth(_auth, _session, callback) {
      callback(null, { user: "mailer" });
    },
    onData(stream, _session, callback) {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => {
        received.push(headerBlock(Buffer.concat(chunks).toString("utf8")));
        callback();
      });
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { port, received, close: () => new Promise<void>((r) => server.close(() => r())) };
}

class RecordingBinding implements SendEmail {
  readonly sent: EmailMessageBuilder[] = [];
  async send(message: EmailMessage | EmailMessageBuilder): Promise<EmailSendResult> {
    this.sent.push(message as EmailMessageBuilder);
    return { messageId: "<cf@example.com>" };
  }
}

describe("POST /send-email — reply_to and headers", () => {
  let mf: Miniflare;
  let d1: D1Database;
  let repository: SendEmailRepository;
  let templates: TemplateRepository;
  let queue: ReturnType<typeof vi.fn>;
  let app: Hono<{ Bindings: Bindings; Variables: UserInfoVariables }>;
  let smtp: Awaited<ReturnType<typeof smtpServer>>;

  beforeAll(async () => {
    smtp = await smtpServer();
  });
  afterAll(async () => {
    await smtp.close();
  });

  beforeEach(async () => {
    const testD1 = await createTestD1();
    mf = testD1.mf;
    d1 = testD1.d1;
    repository = new SendEmailRepository(createDatabase(d1));
    templates = new TemplateRepository(createDatabase(d1));
    // The log row references the API key, and a template its owner: both must exist.
    await createDatabase(d1).insert(user).values({ id: "user-1", name: "Owner", email: "owner@example.com" });
    await createDatabase(d1)
      .insert(apikey)
      .values({ id: "key-1", referenceId: "user-1", key: "hashed", createdAt: new Date(), updatedAt: new Date() });
    queue = vi.fn().mockResolvedValue(undefined);
    app = new Hono();
    app.onError(errorHandler);
    app.use("/send-email", async (c, next) => {
      c.set("userId", "user-1");
      c.set("apiKeyId", "key-1");
      c.set("smtpConfigId", "smtp-1");
      await next();
    });
    app.route("/send-email", createSendEmailController(() => repository, () => templates));
  });
  afterEach(async () => {
    await cleanupTestD1(mf);
  });

  const post = (body: unknown) =>
    app.request(
      "/send-email",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      { AES_256_KEY: AES_KEY, makisend_db: d1, SEND_EMAIL_QUEUE: { send: queue } } as unknown as Bindings,
    );

  const smtpTransport = () =>
    new SmtpEmailTransport(
      {
        smtpHostName: "127.0.0.1",
        smtpPort: smtp.port,
        smtpSecurity: "starttls",
        smtpUsername: "mailer",
        smtpPassword: "irrelevant",
        senderEmail: "sender@example.com",
      },
      { rejectUnauthorized: false },
    );

  it("H1/H2 — Reply-To and the headers go through D1 encrypted and reach the SMTP server", async () => {
    const res = await post({ ...base, reply_to: "support@example.com", headers: unsubscribe });
    expect(res.status).toBe(202);
    const { emailId } = queue.mock.calls[0]![0] as SendEmailQueueMessage;

    const [row] = await createDatabase(d1).select().from(emailContents).where(eq(emailContents.emailId, emailId));
    expect(row!.replyTo).not.toContain("support@example.com");
    expect(row!.headers).not.toContain("shop.example.com");
    expect(JSON.parse(row!.replyTo!)).toHaveProperty("kid");
    expect(JSON.parse(row!.headers!)).toHaveProperty("kid");

    const email = await loadEmailForSending(repository, AES_KEY, emailId);
    expect(email.replyTo).toBe("support@example.com");
    expect(email.headers).toEqual({
      "List-Unsubscribe": "<https://shop.example.com/u/abc>, <mailto:unsubscribe@example.com>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      "X-campaign-id": "receipts-2026",
    });

    await smtpTransport().send(email);
    const received = smtp.received.at(-1)!;
    expect(received.get("reply-to")).toBe("support@example.com");
    expect(received.get("list-unsubscribe")).toBe("<https://shop.example.com/u/abc>, <mailto:unsubscribe@example.com>");
    expect(received.get("list-unsubscribe-post")).toBe("List-Unsubscribe=One-Click");
    expect(received.get("x-campaign-id")).toBe("receipts-2026");
  });

  it("H1 — the Cloudflare binding receives the same Reply-To and headers", async () => {
    await post({ ...base, reply_to: "support@example.com", headers: { "X-Order": "42" } });
    const { emailId } = queue.mock.calls[0]![0] as SendEmailQueueMessage;
    const binding = new RecordingBinding();
    await new CloudflareEmailTransport(binding, "noreply@example.com").send(await loadEmailForSending(repository, AES_KEY, emailId));
    expect(binding.sent[0]).toMatchObject({ replyTo: "support@example.com", headers: { "X-Order": "42" } });
  });

  it("H2 — the key rotation re-encrypts both new columns", () => {
    const columns = ENCRYPTED_COLUMNS.filter((c) => c.table === "email_contents").map((c) => c.column);
    expect(columns).toEqual(expect.arrayContaining(["reply_to", "headers"]));
  });

  it("H3 — a message without them keeps its exact shape, in D1 and on the binding", async () => {
    await post(base);
    const { emailId } = queue.mock.calls[0]![0] as SendEmailQueueMessage;
    const [row] = await createDatabase(d1).select().from(emailContents).where(eq(emailContents.emailId, emailId));
    expect(row!.replyTo).toBeNull();
    expect(row!.headers).toBeNull();

    const email = await loadEmailForSending(repository, AES_KEY, emailId);
    expect(email).not.toHaveProperty("replyTo");
    expect(email).not.toHaveProperty("headers");

    const binding = new RecordingBinding();
    await new CloudflareEmailTransport(binding, "noreply@example.com").send(email);
    expect(binding.sent[0]).not.toHaveProperty("replyTo");
    expect(binding.sent[0]).not.toHaveProperty("headers");
  });

  it("H4 — a templated send keeps the Reply-To and the headers", async () => {
    const template = await templates.create("user-1", {
      name: "Receipt",
      format: "legacy",
      subject: "Reçu {{ref}}",
      html: "<p>Reçu {{ref}}</p>",
      text: "Reçu {{ref}}, merci pour votre achat.",
    });
    const res = await post({
      to: "buyer@example.com",
      templateId: template.id,
      variables: { ref: "REC-9" },
      reply_to: "support@example.com",
      headers: { "X-Template": "receipt" },
    });
    expect(res.status).toBe(202);
    const { emailId } = queue.mock.calls[0]![0] as SendEmailQueueMessage;
    const email = await loadEmailForSending(repository, AES_KEY, emailId);
    expect(email).toMatchObject({ subject: "Reçu REC-9", replyTo: "support@example.com", headers: { "X-Template": "receipt" } });
  });

  it.each([
    ["a CR/LF header injection", { "X-Note": "ok\r\nBcc: victim@example.com" }],
    ["a header that has its own field", { "Reply-To": "a@example.com" }],
    ["a header the transport writes", { "Message-ID": "<forged@example.com>" }],
    ["a header off the allowlist", { Importance: "high" }],
    ["a plain-http unsubscribe link", { "List-Unsubscribe": "<http://shop.example.com/u>" }],
    ["one-click without an https link", { "List-Unsubscribe": "<mailto:u@example.com>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }],
  ])("H5 — refuses %s", async (_case, headers) => {
    const res = await post({ ...base, headers });
    expect(res.status).toBe(400);
    expect(queue).not.toHaveBeenCalled();
  });

  it("H5 — refuses an invalid reply_to", async () => {
    const res = await post({ ...base, reply_to: "support@example.com\r\nBcc: x@example.com" });
    expect(res.status).toBe(400);
  });
});
