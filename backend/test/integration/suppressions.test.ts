/**
 * The suppression list, end to end: real D1 (Miniflare, every migration), the real send
 * workflow flow with nodemailer against a real SMTP server that rejects some recipients, and
 * the real POST /send-email route.
 *
 *  S1  A recipient the server rejects as non-existent (550 5.1.1 at RCPT TO) is suppressed,
 *      and the next send to it is refused with 422 before anything is stored or queued.
 *  S2  A policy refusal (550 5.7.1) or a temporary one (450) never suppresses the address.
 *  S3  The address is matched case-insensitively and is never stored in clear.
 *  S4  The list is per user: another user can still send to the address.
 *  S5  A key rotation keeps lookups working: before the re-hash (previous key still set),
 *      after it, and once the previous key is deleted.
 *  S6  Removing the entry lets the address be sent to again; a foreign id is a 404.
 */
import { SMTPServer } from "smtp-server";
import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Miniflare } from "miniflare";
import type { WorkflowStep } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { encrypt, keyId } from "@/core/crypto";
import { AppError } from "@/core/errors";
import { errorHandler } from "@/middleware/error.handler";
import { createDatabase } from "@/db/connection";
import { suppressions, user } from "@/db/schema";
import { ENCRYPTED_COLUMNS } from "@/key-rotation/key-rotation.repository";
import { createSendEmailController } from "@/send-email/send-email.controller";
import { SendEmailRepository } from "@/send-email/send-email.repository";
import { loadEmailForSending } from "@/send-email/send-email.loader";
import { SuppressionRepository, SuppressionService } from "@/suppressions";
import { TemplateRepository } from "@/templates/templates.repository";
import { SmtpEmailTransport } from "@/transports";
import { runSendEmailFlow } from "@/workflows/send-email.flow";
import { createTestD1, cleanupTestD1 } from "../helpers/d1-setup";
import type { Bindings, UserInfoVariables } from "@/index";
import type { SendEmailQueueMessage } from "@/send-email/send-email.types";

const KEY_1 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const KEY_2 = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

const GHOST = "ghost@example.com";
const BLOCKED = "blocked@example.com";
const GREYLISTED = "greylisted@example.com";

const base = {
  subject: "Votre reçu REC-1",
  text: "Votre paiement est confirmé. Merci.",
  html: "<p>Votre paiement est confirmé.</p>",
};

/** Accepts every recipient except the three test addresses, each with its own refusal. */
async function rejectingSmtpServer() {
  let delivered = 0;
  const server = new SMTPServer({
    onAuth(_auth, _session, callback) {
      callback(null, { user: "mailer" });
    },
    onRcptTo(address, _session, callback) {
      const refusals: Record<string, [number, string]> = {
        [GHOST]: [550, "5.1.1 <ghost@example.com>: Recipient address rejected: User unknown"],
        [BLOCKED]: [550, "5.7.1 Relaying denied"],
        [GREYLISTED]: [450, "4.7.1 Greylisted, try again later"],
      };
      const refusal = refusals[address.address.toLowerCase()];
      if (!refusal) return callback();
      const err = Object.assign(new Error(refusal[1]), { responseCode: refusal[0] });
      return callback(err);
    },
    onData(stream, _session, callback) {
      stream.resume();
      stream.on("end", () => {
        delivered++;
        callback();
      });
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { port, delivered: () => delivered, close: () => new Promise<void>((r) => server.close(() => r())) };
}

/** Runs every step inline; the SMTP step gets two attempts so a transient failure is retried once. */
function inlineStep(): WorkflowStep {
  return {
    async do(name: string, cfgOrFn: unknown, maybeFn?: unknown) {
      const callback = (typeof cfgOrFn === "function" ? cfgOrFn : maybeFn) as (ctx: { attempt: number }) => Promise<unknown>;
      if (name !== "send-mail-via-nodemailer") return callback({ attempt: 1 });
      try {
        return await callback({ attempt: 1 });
      } catch {
        return callback({ attempt: 2 });
      }
    },
  } as unknown as WorkflowStep;
}

describe("suppression list", () => {
  let mf: Miniflare;
  let d1: D1Database;
  let smtp: Awaited<ReturnType<typeof rejectingSmtpServer>>;
  let emails: SendEmailRepository;
  let service: SuppressionService;
  let queue: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    smtp = await rejectingSmtpServer();
  });
  afterAll(async () => {
    await smtp.close();
  });

  beforeEach(async () => {
    const testD1 = await createTestD1();
    mf = testD1.mf;
    d1 = testD1.d1;
    const db = createDatabase(d1);
    await db.insert(user).values([
      { id: "user-1", name: "Owner", email: "owner@example.com" },
      { id: "user-2", name: "Other", email: "other@example.com" },
    ]);
    emails = new SendEmailRepository(db);
    service = new SuppressionService(new SuppressionRepository(db), { current: KEY_1, previous: [] });
    queue = vi.fn().mockResolvedValue(undefined);
  });
  afterEach(async () => {
    await cleanupTestD1(mf);
  });

  function sendApp(userId: string, suppressionService: SuppressionService = service) {
    const app = new Hono<{ Bindings: Bindings; Variables: UserInfoVariables }>();
    app.onError(errorHandler);
    app.use("/send-email", async (c, next) => {
      c.set("userId", userId);
      c.set("smtpConfigId", "smtp-1");
      await next();
    });
    app.route(
      "/send-email",
      createSendEmailController(() => emails, () => new TemplateRepository(createDatabase(d1)), () => suppressionService),
    );
    return (to: string) =>
      app.request(
        "/send-email",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...base, to }) },
        { AES_256_KEY: KEY_1, makisend_db: d1, SEND_EMAIL_QUEUE: { send: queue } } as unknown as Bindings,
      );
  }

  /** The workflow's path for one accepted email: D1 -> nodemailer -> the test SMTP server. */
  async function deliver(emailId: string) {
    return runSendEmailFlow(
      {
        repository: emails,
        loadEmail: (id) => loadEmailForSending(emails, KEY_1, id),
        resolveTransport: async () =>
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
          ),
        suppressRecipient: (id, reason) => service.suppressBouncedEmail(id, reason),
      },
      { emailId },
      inlineStep(),
    );
  }

  async function acceptAndDeliver(post: (to: string) => Response | Promise<Response>, to: string) {
    const res = await post(to);
    expect(res.status).toBe(202);
    const { emailId } = queue.mock.calls.at(-1)![0] as SendEmailQueueMessage;
    return deliver(emailId);
  }

  it("S1/S3 — a 550 5.1.1 at RCPT TO suppresses the address; the next send is refused before storage", async () => {
    const post = sendApp("user-1");
    const outcome = await acceptAndDeliver(post, GHOST);
    expect(outcome).toMatchObject({ outcome: "rejected" });

    const rows = await createDatabase(d1).select().from(suppressions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: "user-1",
      source: "bounce",
      reason: "The recipient's server rejected the address (550 5.1.1).",
      hashKid: await keyId(KEY_1),
    });
    expect(rows[0]!.recipient).not.toContain("ghost");
    expect(rows[0]!.recipientHash).not.toContain("ghost");

    queue.mockClear();
    const refused = await post("GHOST@Example.com");
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as { error: string }).error).toContain("suppression list");
    expect(queue).not.toHaveBeenCalled();
    const logged = await d1.prepare("SELECT COUNT(*) AS n FROM email_logs").first<{ n: number }>();
    expect(logged?.n).toBe(1); // only the first, bounced send
  });

  it("S2 — a policy refusal or a temporary one does not suppress the address", async () => {
    const post = sendApp("user-1");
    expect(await acceptAndDeliver(post, BLOCKED)).toMatchObject({ outcome: "rejected" });
    expect(await acceptAndDeliver(post, GREYLISTED)).toMatchObject({ outcome: "dead_lettered" });
    expect(await createDatabase(d1).select().from(suppressions)).toHaveLength(0);
    expect((await post(BLOCKED)).status).toBe(202);
  });

  it("S1 — a delivered email suppresses nothing", async () => {
    const before = smtp.delivered();
    expect(await acceptAndDeliver(sendApp("user-1"), "real@example.com")).toMatchObject({ outcome: "sent" });
    expect(smtp.delivered()).toBe(before + 1);
    expect(await createDatabase(d1).select().from(suppressions)).toHaveLength(0);
  });

  it("S4 — the list is per user", async () => {
    await service.add("user-1", GHOST, { source: "manual", reason: "Asked to stop" });
    expect((await sendApp("user-1")(GHOST)).status).toBe(422);
    expect((await sendApp("user-2")(GHOST)).status).toBe(202);
  });

  it("S3 — adding twice keeps one row and the first reason", async () => {
    expect(await service.add("user-1", GHOST, { source: "manual", reason: "First" })).toBe(true);
    expect(await service.add("user-1", "Ghost@Example.COM", { source: "bounce", reason: "Second" })).toBe(false);
    const listed = await service.list("user-1");
    expect(listed).toEqual([expect.objectContaining({ email: GHOST, reason: "First", source: "manual" })]);
  });

  it("S5 — lookups survive a key rotation, before and after the re-hash", async () => {
    await service.add("user-1", GHOST, { source: "manual", reason: "Asked to stop" });

    // ENCRYPTION_KEY rotated: KEY_2 current, KEY_1 kept as previous.
    const rotating = new SuppressionService(new SuppressionRepository(createDatabase(d1)), { current: KEY_2, previous: [KEY_1] });
    expect(await rotating.findSuppression("user-1", GHOST)).not.toBeNull();

    expect(await rotating.rehashStale()).toEqual({ rehashed: 1, failed: 0, remaining: 0 });
    const [row] = await createDatabase(d1).select().from(suppressions);
    expect(row!.hashKid).toBe(await keyId(KEY_2));

    // The generic rotation re-encrypts the address column: simulate it, then drop KEY_1.
    await createDatabase(d1)
      .update(suppressions)
      .set({ recipient: await encrypt(GHOST, KEY_2) })
      .where(eq(suppressions.id, row!.id));
    const rotated = new SuppressionService(new SuppressionRepository(createDatabase(d1)), { current: KEY_2, previous: [] });
    expect(await rotated.findSuppression("user-1", GHOST)).not.toBeNull();
    expect(await rotated.list("user-1")).toEqual([expect.objectContaining({ email: GHOST })]);
    expect((await sendApp("user-1", rotated)(GHOST)).status).toBe(422);
  });

  it("S5 — the generic rotation knows the encrypted address column", () => {
    expect(ENCRYPTED_COLUMNS).toContainEqual({ table: "suppressions", primaryKey: "id", column: "recipient" });
  });

  it("S6 — removing the entry allows sending again; another user's id is a 404", async () => {
    await service.add("user-1", GHOST, { source: "manual", reason: "Asked to stop" });
    const [entry] = await service.list("user-1");

    await expect(service.remove(entry!.id, "user-2")).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.remove(entry!.id, "user-2")).rejects.toBeInstanceOf(AppError);
    await service.remove(entry!.id, "user-1");
    expect((await sendApp("user-1")(GHOST)).status).toBe(202);
  });

  it("S6 — deleting the user deletes their list", async () => {
    await service.add("user-1", GHOST, { source: "manual", reason: "Asked to stop" });
    await d1.prepare("PRAGMA foreign_keys = ON").run();
    await createDatabase(d1).delete(user).where(eq(user.id, "user-1"));
    expect(await createDatabase(d1).select().from(suppressions)).toHaveLength(0);
  });
});
