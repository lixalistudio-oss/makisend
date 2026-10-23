/**
 * Attachments, end to end, through the Worker as it is deployed: the exported Hono app and queue
 * handler from `src/index.ts`, the real SendEmailWorkflow class, the real SMTP transport resolver
 * and nodemailer, against a real SMTP server speaking STARTTLS with a certificate the client
 * VERIFIES (`rejectUnauthorized: true`, as in production). Nothing in `src/` is mocked.
 *
 * What a client does, in order:
 *   sign up -> POST /smtp-config -> POST /api-keys -> POST /send-email (x-api-key, attachments)
 *   -> queue consumer -> workflow -> SMTP -> GET /email-logs/:id shows "sent".
 *
 * Failure modes this test exists for (the integration test covers each layer; this one covers
 * the wiring between them):
 *  E1  The production wiring drops the files somewhere between the route and the socket
 *      (index.ts deps, queue consumer, workflow, transport resolver).
 *  E2  A file arrives altered for a real mail client: bytes, name, type, or the order.
 *  E3  A hostile filename turns into a header of the delivered message.
 *  E4  The hourly key rotation runs between the POST and the send: the workflow can no longer
 *      decrypt the attachments (or the rotation skips them and they stay on the old key).
 *  E5  An idempotent retry of the same POST stores or sends the files twice.
 *
 * The only shortcuts, each because the platform piece does not exist outside workerd:
 *  - Queues and Workflows bindings are in-process fakes that call the exported `queue` handler
 *    and `SendEmailWorkflow.run()`; step.do() runs its callback once (no durable retries).
 *  - The SMTP host is set to `localhost` directly in D1: the API rightly refuses loopback hosts
 *    and arbitrary ports, and the server here listens on a random local port.
 *  - The cron is not dispatched through `scheduled()`: `runKeyRotation(env)`, which it calls, is.
 */
import * as tls from "node:tls";
import { createHash } from "node:crypto";
import { SMTPServer } from "smtp-server";
import { simpleParser, type ParsedMail } from "mailparser";
import { generate as generateCertificate } from "selfsigned";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { WorkflowEvent, WorkflowStep, WorkflowStepContext } from "cloudflare:workers";
import worker, { app } from "@/index";
import type { Bindings } from "@/index";
import { SendEmailWorkflow } from "@/workflows";
import type { SendEmailParams, SendEmailRunOutcome } from "@/workflows/send-email.workflow";
import { runKeyRotation } from "@/key-rotation";
import { encrypt, keyId } from "@/core/crypto";
import { createDatabase } from "@/db/connection";
import { emailAttachments, emailHistories, smtpConfig } from "@/db/schema";
import type { SendEmailQueueMessage } from "@/send-email/send-email.types";
import { createTestD1, cleanupTestD1 } from "../helpers/d1-setup";

const ORIGIN = "http://localhost:4321";
const OLD_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const NEW_KEY = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

/** Every byte value, twice: a lossy encoding anywhere on the way shows up in the hash. */
const PDF = Uint8Array.from({ length: 8192 }, (_, i) => i % 256);
const CSV = new TextEncoder().encode("ref;montant\nREC-1;5000\n");
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/**
 * The Content-Type header of a delivered part, as sent. mailparser's `contentType` re-guesses
 * `application/octet-stream` from the file extension, which would hide what MakiSend sent.
 */
const wireType = (a: ParsedMail["attachments"][number]) =>
  (a.headers.get("content-type") as { value: string } | undefined)?.value;

// ---------------------------------------------------------------------------------------------
// Platform bindings that only exist inside workerd, as small in-process implementations.
// ---------------------------------------------------------------------------------------------

/** A Queue binding that buffers messages until the test delivers them to the queue handler. */
class BufferedQueue implements Queue<SendEmailQueueMessage> {
  readonly messages: SendEmailQueueMessage[] = [];
  private readonly response: QueueSendResponse = { metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } };

  async metrics(): Promise<QueueMetrics> {
    return { backlogCount: this.messages.length, backlogBytes: 0 };
  }
  async send(message: SendEmailQueueMessage): Promise<QueueSendResponse> {
    this.messages.push(message);
    return this.response;
  }
  async sendBatch(messages: Iterable<MessageSendRequest<SendEmailQueueMessage>>): Promise<QueueSendBatchResponse> {
    for (const { body } of messages) this.messages.push(body);
    return this.response;
  }
  /** Hands every buffered message to the Worker's exported queue handler, like Cloudflare Queues. */
  async deliver(env: Bindings): Promise<void> {
    const pending = this.messages.splice(0);
    const acked: string[] = [];
    const batch: MessageBatch<SendEmailQueueMessage> = {
      queue: "send-email",
      metadata: { metrics: { backlogCount: pending.length, backlogBytes: 0 } },
      messages: pending.map((body, i) => ({
        id: `msg-${i}`,
        timestamp: new Date(),
        body,
        attempts: 1,
        ack: () => acked.push(body.emailId),
        retry: () => {
          throw new Error(`queue handler asked to retry ${body.emailId}`);
        },
      })),
      ackAll: () => undefined,
      retryAll: () => undefined,
    };
    await worker.queue(batch, env);
    expect(acked).toEqual(pending.map((m) => m.emailId));
  }
}

/** step.do() runs its callback once, with attempt 1; the outputs are what Workflows would store. */
class InlineStep implements WorkflowStep {
  readonly outputs: unknown[] = [];
  // One signature covering every overload: `do(name, callback)` and `do(name, config, callback)`.
  async do<T>(name: string, configOrCallback: unknown, maybeCallback?: unknown): Promise<T> {
    const callback = (typeof configOrCallback === "function" ? configOrCallback : maybeCallback) as (
      ctx: WorkflowStepContext,
    ) => Promise<T>;
    const output = await callback({ step: { name, count: 1 }, attempt: 1, config: {} });
    this.outputs.push(output);
    return output;
  }
  sleep = async () => undefined;
  sleepUntil = async () => undefined;
  waitForEvent(): never {
    throw new Error("send-email workflow never waits for an event");
  }
}

class CompletedInstance implements WorkflowInstance {
  constructor(public id: string, private readonly output: SendEmailRunOutcome) {}
  async pause() {}
  async resume() {}
  async terminate() {}
  async restart() {}
  async delete() {}
  async status(): Promise<InstanceStatus> {
    return { status: "complete", output: this.output };
  }
  async sendEvent() {}
}

/** A Workflow binding that runs the real SendEmailWorkflow class to completion on create(). */
class InProcessWorkflow implements Workflow<SendEmailParams> {
  readonly runs = new Map<string, { outcome: SendEmailRunOutcome; step: InlineStep }>();
  constructor(private readonly getEnv: () => Bindings) {}

  async create(options?: WorkflowInstanceCreateOptions<SendEmailParams>): Promise<WorkflowInstance> {
    const id = options?.id;
    const params = options?.params;
    if (!id || !params) throw new Error("create() without id/params");
    if (this.runs.has(id)) throw new Error(`instance ${id} already exists`);
    const event: WorkflowEvent<SendEmailParams> = {
      payload: params,
      timestamp: new Date(),
      instanceId: id,
      workflowName: "send-email",
    };
    const step = new InlineStep();
    // The workflow never reads its ExecutionContext.
    const outcome = await new SendEmailWorkflow({} as never, this.getEnv()).run(event, step);
    this.runs.set(id, { outcome, step });
    return new CompletedInstance(id, outcome);
  }
  async get(id: string): Promise<WorkflowInstance> {
    const run = this.runs.get(id);
    if (!run) throw new Error(`no instance ${id}`);
    return new CompletedInstance(id, run.outcome);
  }
  async createBatch(): Promise<WorkflowInstance[]> {
    throw new Error("not used");
  }
  async deleteBatch(): Promise<WorkflowBatchDeleteResult> {
    throw new Error("not used");
  }
}

const noAssets: Fetcher = {
  fetch: async () => new Response("not found", { status: 404 }),
  connect: () => {
    throw new Error("not used");
  },
};

// ---------------------------------------------------------------------------------------------
// A real SMTP server: STARTTLS, AUTH required, raw message parsed the way a mail client does.
// ---------------------------------------------------------------------------------------------

interface Delivered {
  envelope: { from: string; to: string[] };
  auth: string | undefined;
  secure: boolean;
  mail: ParsedMail;
}

async function startSmtpServer(cert: string, key: string) {
  const delivered: Delivered[] = [];
  const server = new SMTPServer({
    key,
    cert,
    authOptional: false,
    onAuth(auth, _session, callback) {
      if (auth.username === "mailer" && auth.password === "smtp-password") {
        return callback(null, { user: auth.username });
      }
      return callback(new Error("Invalid username or password"));
    },
    onData(stream, session, callback) {
      simpleParser(stream)
        .then((mail) => {
          delivered.push({
            envelope: {
              from: session.envelope.mailFrom ? session.envelope.mailFrom.address : "",
              to: session.envelope.rcptTo.map((r) => r.address),
            },
            auth: typeof session.user === "string" ? session.user : undefined,
            secure: session.secure,
            mail,
          });
          callback();
        })
        .catch(callback);
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.server.address();
  if (!address || typeof address === "string") throw new Error("SMTP server has no port");
  return {
    port: address.port,
    delivered,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// ---------------------------------------------------------------------------------------------

describe("e2e — POST /send-email with attachments, through the deployed Worker", () => {
  let mf: Parameters<typeof cleanupTestD1>[0];
  let d1: D1Database;
  let smtp: Awaited<ReturnType<typeof startSmtpServer>>;
  let env: Bindings;
  let queue: BufferedQueue;
  let workflow: InProcessWorkflow;
  let cookie = "";
  let apiKey = "";
  let smtpConfigId = "";
  const defaultCAs = tls.getCACertificates("default");

  const makeEnv = (keys: Pick<Bindings, "ENCRYPTION_KEY" | "ENCRYPTION_KEY_PREVIOUS">): Bindings => ({
    ...keys,
    makisend_db: d1,
    BETTER_AUTH_SECRET: "e2e-better-auth-secret-0123456789",
    BETTER_AUTH_URL: "http://localhost:8787",
    FRONTEND_URL: ORIGIN,
    RATE_LIMIT: "off",
    SEND_EMAIL_QUEUE: queue,
    SEND_EMAIL_DLQ: new BufferedQueue(),
    SEND_EMAIL_WORKFLOW: workflow,
    ASSETS: noAssets,
  });

  const call = (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
    app.request(
      path,
      {
        method: init.method ?? "GET",
        headers: { "Content-Type": "application/json", Origin: ORIGIN, ...init.headers },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      },
      env,
    );

  const sendEmail = (body: unknown, headers: Record<string, string> = {}) =>
    call("/send-email", { method: "POST", body, headers: { "x-api-key": apiKey, ...headers } });

  beforeAll(async () => {
    // A self-signed certificate for `localhost`, trusted by this process only: the transport
    // keeps verifying certificates exactly as it does in production.
    const pems = await generateCertificate([{ name: "commonName", value: "localhost" }], {
      keySize: 2048,
      extensions: [{ name: "subjectAltName", altNames: [{ type: 2, value: "localhost" }] }],
    });
    tls.setDefaultCACertificates([...defaultCAs, pems.cert]);
    smtp = await startSmtpServer(pems.cert, pems.private);

    const testD1 = await createTestD1();
    mf = testD1.mf;
    d1 = testD1.d1;
    queue = new BufferedQueue();
    workflow = new InProcessWorkflow(() => env);
    env = makeEnv({ ENCRYPTION_KEY: OLD_KEY });

    // 1. The instance's first connection creates its super admin.
    const signUp = await call("/api/auth/sign-up/email", {
      method: "POST",
      body: { email: "owner@example.com", password: "password-e2e-123" },
    });
    expect(signUp.status, await signUp.clone().text()).toBe(200);
    cookie = signUp.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");

    // 2. An SMTP configuration, through the API (validated and encrypted by the service)...
    const created = await call("/smtp-config", {
      method: "POST",
      headers: { Cookie: cookie },
      body: {
        smtpHostname: "smtp.example.com",
        smtpPort: 587,
        smtpUsername: "mailer",
        smtpPassword: "smtp-password",
        senderEmail: "receipts@shop.example",
      },
    });
    expect(created.status, await created.clone().text()).toBe(201);
    smtpConfigId = ((await created.json()) as { config: { id: string } }).config.id;

    // ...pointed at the local server. The API refuses loopback hosts and random ports.
    await createDatabase(d1)
      .update(smtpConfig)
      .set({ smtpHostname: await encrypt("localhost", OLD_KEY), smtpPort: smtp.port, smtpSecurity: "starttls" })
      .where(eq(smtpConfig.id, smtpConfigId));

    // 3. An API key bound to that configuration.
    const key = await call("/api-keys", {
      method: "POST",
      headers: { Cookie: cookie },
      body: { smtpConfigId, name: "e2e" },
    });
    expect(key.status, await key.clone().text()).toBe(201);
    apiKey = ((await key.json()) as { key: string }).key;
  });

  afterAll(async () => {
    tls.setDefaultCACertificates(defaultCAs);
    await smtp?.close();
    await cleanupTestD1(mf);
  });

  it("E1/E2/E3/E5 — the files reach the SMTP server intact, once, and the log says sent", async () => {
    const payload = {
      to: "buyer@example.com",
      subject: "Votre reçu REC-1",
      text: "Votre paiement est confirmé. Le reçu est joint.",
      html: "<p>Votre paiement est <strong>confirmé</strong>.</p>",
      attachments: [
        { filename: "reçu REC-1.pdf", content: b64(PDF), content_type: "application/pdf" },
        { filename: "détail.csv", content: b64(CSV) },
      ],
    };

    // E5: the client retries the same POST (Idempotency-Key): same emailId, one set of rows.
    const first = await sendEmail(payload, { "Idempotency-Key": "e2e-receipt-REC-1" });
    const retry = await sendEmail(payload, { "Idempotency-Key": "e2e-receipt-REC-1" });
    expect(first.status, await first.clone().text()).toBe(202);
    expect(retry.status).toBe(202);
    expect(retry.headers.get("Idempotency-Replayed")).toBe("true");
    const { emailId } = (await first.json()) as { emailId: string };
    expect(((await retry.json()) as { emailId: string }).emailId).toBe(emailId);

    expect(queue.messages).toEqual([{ emailId }]);
    const stored = await createDatabase(d1).select().from(emailAttachments).where(eq(emailAttachments.emailId, emailId));
    expect(stored.map((r) => [r.position, r.filename, r.contentType])).toEqual([
      [0, "reçu REC-1.pdf", "application/pdf"],
      [1, "détail.csv", "application/octet-stream"],
    ]);

    // The platform delivers the message: queue handler -> workflow -> SMTP.
    await queue.deliver(env);
    const run = workflow.runs.get(emailId);
    expect(run?.outcome).toMatchObject({ outcome: "sent", attempt: 1 });
    // Workflows persists step outputs: none of them may carry the files.
    expect(JSON.stringify(run?.step.outputs)).not.toContain(b64(PDF).slice(0, 64));

    expect(smtp.delivered).toHaveLength(1);
    const [received] = smtp.delivered;
    expect(received.secure).toBe(true); // STARTTLS with a verified certificate
    expect(received.auth).toBe("mailer");
    expect(received.envelope).toEqual({ from: "receipts@shop.example", to: ["buyer@example.com"] });
    expect(received.mail.subject).toBe(payload.subject);
    expect(received.mail.text?.trim()).toBe(payload.text);
    expect(received.mail.html).toContain("<strong>confirmé</strong>");

    // E2: what a mail client gets — name, type, bytes, in the order sent.
    expect(
      received.mail.attachments.map((a) => ({
        filename: a.filename,
        contentType: wireType(a),
        disposition: a.contentDisposition,
        size: a.content.length,
        sha256: sha256(a.content),
      })),
    ).toEqual([
      { filename: "reçu REC-1.pdf", contentType: "application/pdf", disposition: "attachment", size: PDF.length, sha256: sha256(PDF) },
      { filename: "détail.csv", contentType: "application/octet-stream", disposition: "attachment", size: CSV.length, sha256: sha256(CSV) },
    ]);
    // E3: no header the caller did not ask for.
    expect(received.mail.headers.has("bcc")).toBe(false);

    // The dashboard sees the delivery.
    const log = await call(`/email-logs/${emailId}`, { headers: { Cookie: cookie } });
    expect(log.status).toBe(200);
    const { log: detail } = (await log.json()) as {
      log: { to: string; sentAt: string | null; smtpId: string | null; history: { status: string }[] };
    };
    expect(detail.to).toBe("buyer@example.com");
    expect(detail.sentAt).not.toBeNull();
    expect(detail.smtpId).toBe(received.mail.messageId);
    expect(detail.history.map((h) => h.status)).toEqual(
      expect.arrayContaining(["received", "processing", "cleaned", "sent"]),
    );
  });

  it("E3 — a filename carrying CRLF + Bcc is refused at the door, nothing is queued or sent", async () => {
    const before = smtp.delivered.length;
    const res = await sendEmail({
      to: "buyer@example.com",
      subject: "Votre reçu",
      text: "Votre paiement est confirmé.",
      html: "<p>ok</p>",
      attachments: [{ filename: "recu.pdf\r\nBcc: attacker@evil.example", content: b64(CSV) }],
    });
    expect(res.status).toBe(400);
    expect(queue.messages).toEqual([]);
    expect(smtp.delivered).toHaveLength(before);
  });

  it("E4 — a key rotation between the POST and the send: re-encrypted, still delivered intact", async () => {
    const res = await sendEmail({
      to: "buyer@example.com",
      subject: "Reçu après rotation",
      text: "Le reçu est joint, chiffré puis re-chiffré.",
      html: "<p>Reçu</p>",
      attachments: [{ filename: "recu.pdf", content: b64(PDF), content_type: "application/pdf" }],
    });
    expect(res.status).toBe(202);
    const { emailId } = (await res.json()) as { emailId: string };

    // The operator rotates ENCRYPTION_KEY; the hourly cron runs before the queue delivers.
    env = makeEnv({ ENCRYPTION_KEY: NEW_KEY, ENCRYPTION_KEY_PREVIOUS: OLD_KEY });
    await runKeyRotation(env);

    const newKid = await keyId(NEW_KEY);
    const [row] = await createDatabase(d1).select().from(emailAttachments).where(eq(emailAttachments.emailId, emailId));
    expect((JSON.parse(row.content) as { kid: string }).kid).toBe(newKid);

    // The old key is gone from the Worker: only the new one can read the file now.
    env = makeEnv({ ENCRYPTION_KEY: NEW_KEY });
    const before = smtp.delivered.length;
    await queue.deliver(env);
    expect(workflow.runs.get(emailId)?.outcome).toMatchObject({ outcome: "sent" });

    expect(smtp.delivered).toHaveLength(before + 1);
    const mail = smtp.delivered.at(-1)!.mail;
    expect(mail.subject).toBe("Reçu après rotation");
    expect(mail.attachments.map((a) => [a.filename, wireType(a), sha256(a.content)])).toEqual([
      ["recu.pdf", "application/pdf", sha256(PDF)],
    ]);

    const statuses = await createDatabase(d1)
      .select({ status: emailHistories.status })
      .from(emailHistories)
      .where(eq(emailHistories.emailId, emailId));
    expect(statuses.map((s) => s.status)).toContain("sent");
  });
});
