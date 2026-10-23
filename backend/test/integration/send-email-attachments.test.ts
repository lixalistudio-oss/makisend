/**
 * Attachments on POST /send-email, end to end: the real route and validation, the real D1
 * (Miniflare, every migration), the loader the workflow uses, and nodemailer against a real
 * SMTP server (`smtp-server`) on a random port. Nothing mocks the storage or the socket.
 *
 * Written from the ways it could fail, before the code:
 *
 *  A1  A file arrives corrupted: the bytes the SMTP server decodes differ from the bytes sent.
 *  A2  The order, the name or the type of the files changes on the way.
 *  A3  The file sits in clear in D1, or travels through the queue (the queue must stay `{ emailId }`).
 *  A4  A message WITHOUT attachments changes shape: the loader suddenly returns `attachments: []`.
 *  A5  A payload Resend would accept is refused here (`content_type` optional, as in Resend).
 *  A6  A hostile or broken entry is accepted: not base64, too large, too many files, a filename that
 *      can inject a MIME header (CR/LF) or name a path, `path` (a URL to fetch), an unknown field.
 *  A7  A key rotation forgets the new column and leaves attachments on the old key.
 *  A8  Deleting the e-mail leaves its attachments behind.
 *  A9  A templated send (`templateId`) drops the attachments while rendering to the inline shape.
 *
 * Artefact: `test/artifacts/send-email-attachments.json` (deterministic: no ids, no dates) —
 * the validation verdict of every case and what the SMTP server received, for a later run to diff.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { SMTPServer } from "smtp-server";
import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Miniflare } from "miniflare";
import { eq } from "drizzle-orm";
import { errorHandler } from "@/middleware/error.handler";
import { createSendEmailController } from "@/send-email/send-email.controller";
import { SendEmailRepository } from "@/send-email/send-email.repository";
import { loadEmailForSending } from "@/send-email/send-email.loader";
import { SmtpEmailTransport } from "@/transports";
import { TemplateRepository } from "@/templates/templates.repository";
import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES } from "@/send-email/attachments";
import { createDatabase } from "@/db/connection";
import { emailAttachments, emailLogs, user } from "@/db/schema";
import { ENCRYPTED_COLUMNS } from "@/key-rotation/key-rotation.repository";
import { createTestD1, cleanupTestD1 } from "../helpers/d1-setup";
import type { Bindings, UserInfoVariables } from "@/index";
import type { SendEmailQueueMessage } from "@/send-email/send-email.types";

const AES_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const artefact: Record<string, unknown> = {};

/** A deterministic "PDF": every byte value, so a lossy encoding anywhere shows up. */
const PDF = Uint8Array.from({ length: 4096 }, (_, i) => i % 256);
const CSV = new TextEncoder().encode("ref,amount\nREC-1,5000\n");
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex").slice(0, 16);

const base = {
  to: "buyer@example.com",
  subject: "Votre reçu REC-1",
  text: "Votre paiement est confirmé. Le reçu est joint.",
  html: "<p>Votre paiement est confirmé.</p>",
};

interface Received {
  attachments: { filename: string; contentType: string; sha: string; size: number }[];
  text: string;
}

/**
 * The parts of a multipart message, read the way a mail client does: each part's headers, then
 * its base64 body decoded. Enough for nodemailer's output (base64 for binary parts); no parser
 * dependency added for one test.
 */
function parseMime(raw: string): Received {
  const boundaries = [...raw.matchAll(/boundary="?([^";\r\n]+)"?/g)].map((m) => m[1]);
  const parts = boundaries.flatMap((boundary) => raw.split(`--${boundary}`).slice(1, -1));
  const attachments: Received["attachments"] = [];
  let text = "";
  for (const part of parts) {
    const split = part.search(/\r?\n\r?\n/);
    const headers = part.slice(0, split).replace(/\r?\n[ \t]+/g, " ");
    const body = part.slice(split).trim();
    const type = /content-type:\s*([^;\r\n]+)/i.exec(headers)?.[1].trim() ?? "";
    const filename = /filename\*?=(?:"([^"]+)"|([^;\r\n]+))/i.exec(headers);
    if (/content-disposition:\s*attachment/i.test(headers)) {
      const bytes = new Uint8Array(Buffer.from(body.replace(/\s+/g, ""), "base64"));
      attachments.push({ filename: (filename?.[1] ?? filename?.[2] ?? "").trim(), contentType: type, sha: sha(bytes), size: bytes.length });
    } else if (type === "text/plain") {
      const encoding = /content-transfer-encoding:\s*(\S+)/i.exec(headers)?.[1].toLowerCase();
      text = encoding === "base64" ? Buffer.from(body, "base64").toString("utf8") : body;
      if (encoding === "quoted-printable") {
        text = Buffer.from(text.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), "latin1").toString("utf8");
      }
      text = text.trim();
    }
  }
  return { attachments, text };
}

async function smtpServer() {
  const received: Received[] = [];
  const server = new SMTPServer({
    onAuth(_auth, _session, callback) {
      callback(null, { user: "mailer" });
    },
    onData(stream, _session, callback) {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => {
        received.push(parseMime(Buffer.concat(chunks).toString("utf8")));
        callback();
      });
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { port, received, close: () => new Promise<void>((r) => server.close(() => r())) };
}

describe("POST /send-email — attachments (Resend's shape)", () => {
  let mf: Miniflare;
  let d1: D1Database;
  let repository: SendEmailRepository;
  let queue: ReturnType<typeof vi.fn>;
  let app: Hono<{ Bindings: Bindings; Variables: UserInfoVariables }>;
  let smtp: Awaited<ReturnType<typeof smtpServer>>;
  let templates: TemplateRepository;

  beforeAll(async () => {
    smtp = await smtpServer();
  });
  afterAll(async () => {
    await smtp.close();
    writeFileSync(
      join(import.meta.dirname, "../artifacts/send-email-attachments.json"),
      `${JSON.stringify(artefact, null, 2)}\n`,
    );
  });

  beforeEach(async () => {
    const testD1 = await createTestD1();
    mf = testD1.mf;
    d1 = testD1.d1;
    repository = new SendEmailRepository(createDatabase(d1));
    // email_logs has no FK to a user row: the controller writes the id it is given.
    queue = vi.fn().mockResolvedValue(undefined);
    app = new Hono();
    app.onError(errorHandler);
    app.use("/send-email", async (c, next) => {
      c.set("userId", "user-1");
      c.set("apiKeyId", null as unknown as string);
      c.set("smtpConfigId", null as unknown as string);
      await next();
    });
    templates = new TemplateRepository(createDatabase(d1));
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

  it("A1/A2/A3 — two files go through D1 encrypted and reach the SMTP server byte for byte, in order", async () => {
    const res = await post({
      ...base,
      attachments: [
        { filename: "recu-REC-1.pdf", content: b64(PDF), content_type: "application/pdf" },
        { filename: "detail.csv", content: b64(CSV) },
      ],
    });
    expect(res.status).toBe(202);

    // A3: the queue carries the id only.
    const message = queue.mock.calls[0][0] as SendEmailQueueMessage;
    expect(Object.keys(message)).toEqual(["emailId"]);

    // A3: nothing readable in D1.
    const rows = await createDatabase(d1).select().from(emailAttachments).where(eq(emailAttachments.emailId, message.emailId));
    expect(rows.map((r) => [r.position, r.filename, r.contentType])).toEqual([
      [0, "recu-REC-1.pdf", "application/pdf"],
      [1, "detail.csv", "application/octet-stream"],
    ]);
    for (const row of rows) {
      expect(row.content).not.toContain(b64(PDF).slice(0, 40));
      expect(JSON.parse(row.content)).toHaveProperty("kid");
    }

    // The workflow's path: rebuild from D1, send through nodemailer.
    const email = await loadEmailForSending(repository, AES_KEY, message.emailId);
    await new SmtpEmailTransport({
      smtpHostName: "127.0.0.1",
      smtpPort: smtp.port,
      smtpSecurity: "starttls",
      smtpUsername: "mailer",
      smtpPassword: "irrelevant",
      senderEmail: "sender@example.com",
    }, { rejectUnauthorized: false }).send(email);

    const mail = smtp.received.at(-1)!;
    expect(mail.attachments).toEqual([
      { filename: "recu-REC-1.pdf", contentType: "application/pdf", sha: sha(PDF), size: PDF.length },
      { filename: "detail.csv", contentType: "application/octet-stream", sha: sha(CSV), size: CSV.length },
    ]);
    expect(mail.text).toBe(base.text);
    artefact["A1:received"] = mail;
    artefact["A3:stored"] = rows.map((r) => ({ position: r.position, filename: r.filename, contentType: r.contentType, encrypted: true }));
  });

  it("A4 — a message without attachments keeps the shape it had before", async () => {
    const res = await post(base);
    expect(res.status).toBe(202);
    const { emailId } = queue.mock.calls[0][0] as SendEmailQueueMessage;
    const email = await loadEmailForSending(repository, AES_KEY, emailId);
    expect(email).toEqual({ ...base, smtpConfigId: null });
    expect(await createDatabase(d1).select().from(emailAttachments).all()).toEqual([]);
    artefact["A4:keys"] = Object.keys(email).sort();
  });

  it("A8 — deleting the e-mail deletes its attachments", async () => {
    await post({ ...base, attachments: [{ filename: "a.pdf", content: b64(PDF) }] });
    const { emailId } = queue.mock.calls[0][0] as SendEmailQueueMessage;
    const db = createDatabase(d1);
    await d1.exec("PRAGMA foreign_keys = ON");
    await db.delete(emailLogs).where(eq(emailLogs.internalId, emailId));
    expect(await db.select().from(emailAttachments).all()).toEqual([]);
  });

  it("A5/A6 — what is accepted and what is refused", async () => {
    const tooBig = new Uint8Array(MAX_ATTACHMENT_BYTES + 1);
    const atLimit = new Uint8Array(MAX_ATTACHMENT_BYTES);
    const one = { filename: "a.pdf", content: b64(CSV) };
    const cases: Record<string, unknown> = {
      "resend shape, no content_type": [one],
      "exactly the size limit": [{ filename: "max.bin", content: b64(atLimit) }],
      [`${MAX_ATTACHMENTS} files`]: Array.from({ length: MAX_ATTACHMENTS }, () => one),
      "empty list": [],
      "not base64": [{ filename: "a.pdf", content: "not base64!!" }],
      "base64 with a line break": [{ filename: "a.pdf", content: `${b64(CSV).slice(0, 8)}\n${b64(CSV).slice(8)}` }],
      "one byte over the limit": [{ filename: "big.bin", content: b64(tooBig) }],
      [`${MAX_ATTACHMENTS + 1} files`]: Array.from({ length: MAX_ATTACHMENTS + 1 }, () => one),
      "CRLF in the filename": [{ filename: "a.pdf\r\nBcc: x@example.com", content: b64(CSV) }],
      "path in the filename": [{ filename: "../etc/passwd", content: b64(CSV) }],
      "content_type with a parameter": [{ filename: "a.txt", content: b64(CSV), content_type: "text/plain; charset=utf-8" }],
      "resend path (URL)": [{ filename: "a.pdf", path: "https://example.com/a.pdf" }],
      "unknown field": [{ ...one, inline: true }],
      "empty filename": [{ filename: " ", content: b64(CSV) }],
    };
    const verdicts: Record<string, number> = {};
    for (const [name, attachments] of Object.entries(cases)) {
      verdicts[name] = (await post({ ...base, attachments })).status;
    }
    expect(verdicts).toEqual({
      "resend shape, no content_type": 202,
      "exactly the size limit": 202,
      [`${MAX_ATTACHMENTS} files`]: 202,
      "empty list": 202,
      "not base64": 400,
      "base64 with a line break": 400,
      "one byte over the limit": 400,
      [`${MAX_ATTACHMENTS + 1} files`]: 400,
      "CRLF in the filename": 400,
      "path in the filename": 400,
      "content_type with a parameter": 400,
      "resend path (URL)": 400,
      "unknown field": 400,
      "empty filename": 400,
    });
    artefact["A5/A6:verdicts"] = verdicts;
  });

  it("A9 — a templated send keeps its attachments", async () => {
    await createDatabase(d1).insert(user).values({ id: "user-1", name: "Owner", email: "owner@example.com" });
    const template = await templates.create("user-1", {
      name: "Reçu",
      subject: "Votre reçu {{ref}}",
      format: "legacy",
      html: "<p>Reçu {{ref}}</p>",
      text: "Votre reçu {{ref}} est joint.",
    });
    const res = await post({
      to: base.to,
      templateId: template.id,
      variables: { ref: "REC-2" },
      attachments: [{ filename: "recu-REC-2.pdf", content: b64(PDF), content_type: "application/pdf" }],
    });
    expect(res.status).toBe(202);
    const { emailId } = queue.mock.calls[0][0] as SendEmailQueueMessage;
    const email = await loadEmailForSending(repository, AES_KEY, emailId);
    expect(email.subject).toBe("Votre reçu REC-2");
    expect(email.attachments?.map((a) => [a.filename, a.contentType, sha(a.content)])).toEqual([
      ["recu-REC-2.pdf", "application/pdf", sha(PDF)],
    ]);
  });

  it("A7 — the key rotation re-encrypts the attachment column", () => {
    expect(ENCRYPTED_COLUMNS).toContainEqual({ table: "email_attachments", primaryKey: "id", column: "content" });
  });
});
