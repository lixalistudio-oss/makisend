/**
 * Bounce webhooks, end to end: real D1 (Miniflare, every migration), the real route, real
 * signatures made the way each provider makes them (Svix HMAC, SendGrid ECDSA P-256, Mailgun
 * HMAC, Postmark Basic auth), and a real SMTP server to read what a send carries.
 *
 *  B1  A signed Resend hard bounce, matched by Message-ID: history row, address suppressed.
 *  B2  A bad signature, a stale Svix timestamp, an unknown configuration or one without a
 *      webhook all answer 401 and write nothing.
 *  B3  A provider retry of the same event is applied once.
 *  B4  SendGrid batch: only dead-address bounces and complaints suppress; a block, a policy
 *      refusal (5.7.1) and a delivery never do.
 *  B5  Mailgun with redacted recipients: the address comes from the matched log; a temporary
 *      failure is "deferred".
 *  B6  Postmark: Basic auth password, hard bounce matched through metadata.
 *  B7  An event naming another user's email, or another address than the log's, never touches
 *      that log.
 *  B8  Saving a webhook checks the secret's shape and never returns it; disconnecting it makes
 *      the provider's requests fail.
 *  B9  A send through a configuration with a webhook carries Message-ID <emailId@domain> and
 *      the provider's tag; a tag header the caller set is left alone.
 *  B10 The daily prune forgets events older than 30 days.
 */
import { createHmac, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { SMTPServer } from "smtp-server";
import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Miniflare } from "miniflare";
import { eq } from "drizzle-orm";
import { encrypt } from "@/core/crypto";
import { errorHandler } from "@/middleware/error.handler";
import { createDatabase } from "@/db/connection";
import { deliveryEvents, emailHistories, emailLogs, smtpConfig, suppressions, user } from "@/db/schema";
import {
  BounceWebhookRepository,
  BounceWebhookService,
  createBounceWebhooksController,
  runDeliveryEventsPrune,
} from "@/bounce-webhooks";
import { SmtpConfigRepository, SmtpConfigService } from "@/smtp-config";
import { toPublicSmtpConfig } from "@/smtp-config/smtp-config.types";
import { SuppressionRepository, SuppressionService } from "@/suppressions";
import { SmtpEmailTransport } from "@/transports";
import { bytesToBase64, bytesToHex } from "@/bounce-webhooks/signatures";
import { createTestD1, cleanupTestD1 } from "../helpers/d1-setup";
import type { Bindings } from "@/index";

const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const KEYS = { current: KEY, previous: [] };
const SENDER = "billing@shop.example";

const EMAIL_ID = "ckmakisendemail000000001";
const OTHER_USER_EMAIL_ID = "ckmakisendemail000000002";
const RECIPIENT = "ghost@example.com";

const RESEND_SECRET = `whsec_${bytesToBase64(randomBytes(24))}`;
const MAILGUN_KEY = "mg-signing-key-0123456789";
const POSTMARK_PASSWORD = "postmark-basic-auth-password";
const sendgridKeys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const SENDGRID_PUBLIC_KEY = bytesToBase64(sendgridKeys.publicKey.export({ type: "spki", format: "der" }));

function svixHeaders(body: string, id = "msg_1", timestamp = Math.floor(Date.now() / 1000)) {
  const key = Buffer.from(RESEND_SECRET.slice("whsec_".length), "base64");
  const signature = bytesToBase64(createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest());
  return { "svix-id": id, "svix-timestamp": String(timestamp), "svix-signature": `v1,${signature}` };
}

function sendgridHeaders(body: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = bytesToBase64(sign("sha256", Buffer.from(timestamp + body), sendgridKeys.privateKey));
  return {
    "X-Twilio-Email-Event-Webhook-Signature": signature,
    "X-Twilio-Email-Event-Webhook-Timestamp": timestamp,
  };
}

function mailgunSignature(key = MAILGUN_KEY) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const token = bytesToHex(randomBytes(25));
  return { timestamp, token, signature: bytesToHex(createHmac("sha256", key).update(timestamp + token).digest()) };
}

function resendBounce(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: "email.bounced",
    created_at: new Date().toISOString(),
    data: {
      email_id: "56761188-7520-42d8-8898-ff6fc54ce618",
      message_id: `<${EMAIL_ID}@shop.example>`,
      from: SENDER,
      to: [RECIPIENT],
      subject: "Votre reçu",
      bounce: {
        message: `The recipient's mailbox ${RECIPIENT} does not exist.`,
        subType: "General",
        type: "Permanent",
      },
      ...overrides,
    },
  });
}

describe("bounce webhooks", () => {
  let mf: Miniflare;
  let d1: D1Database;
  let db: ReturnType<typeof createDatabase>;
  let suppressionService: SuppressionService;
  let app: Hono<{ Bindings: Bindings }>;

  async function connect(id: string, provider: "resend" | "sendgrid" | "mailgun" | "postmark", secret: string) {
    await db
      .update(smtpConfig)
      .set({ bounceWebhookProvider: provider, bounceWebhookSecret: await encrypt(secret, KEYS) })
      .where(eq(smtpConfig.id, id));
  }

  async function logEmail(emailId: string, userId: string, to: string) {
    await db.insert(emailLogs).values({ internalId: emailId, userId, to: await encrypt(to, KEYS), subject: "Votre reçu" });
    await db.insert(emailHistories).values({ emailId, status: "sent", attempts: 1 });
  }

  const post = (configId: string, body: string, headers: Record<string, string>) =>
    app.request(`/webhooks/bounces/${configId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body,
    });

  const historyOf = (emailId: string) =>
    db.select().from(emailHistories).where(eq(emailHistories.emailId, emailId)).orderBy(emailHistories.createdAt);

  beforeEach(async () => {
    const testD1 = await createTestD1();
    mf = testD1.mf;
    d1 = testD1.d1;
    db = createDatabase(d1);
    await db.insert(user).values([
      { id: "user-1", name: "Owner", email: "owner@example.com" },
      { id: "user-2", name: "Other", email: "other@example.com" },
    ]);
    const smtpRow = async (id: string, userId: string) => ({
      id,
      userId,
      smtpHostname: await encrypt("smtp.example.com", KEYS),
      smtpUsername: await encrypt("mailer", KEYS),
      smtpPassword: await encrypt("password", KEYS),
      senderEmail: await encrypt(SENDER, KEYS),
    });
    await db.insert(smtpConfig).values([await smtpRow("cfg-1", "user-1"), await smtpRow("cfg-2", "user-2")]);
    await logEmail(EMAIL_ID, "user-1", RECIPIENT);
    await logEmail(OTHER_USER_EMAIL_ID, "user-2", RECIPIENT);

    suppressionService = new SuppressionService(new SuppressionRepository(db), KEYS);
    const service = new BounceWebhookService(new BounceWebhookRepository(db), suppressionService, KEYS);
    app = new Hono<{ Bindings: Bindings }>();
    app.onError(errorHandler);
    app.route("/webhooks/bounces", createBounceWebhooksController(() => service));
  });
  afterEach(async () => {
    await cleanupTestD1(mf);
  });

  it("B1 — a signed Resend hard bounce is matched by Message-ID, logged and suppressed", async () => {
    await connect("cfg-1", "resend", RESEND_SECRET);
    const body = resendBounce();
    const res = await post("cfg-1", body, svixHeaders(body));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, received: 1, duplicates: 0, matched: 1, suppressed: 1 });

    const history = await historyOf(EMAIL_ID);
    expect(history.map((row) => row.status)).toEqual(["sent", "bounced"]);
    expect(history[1]!.error).toBe("Hard bounce reported by Resend (Permanent · General)");

    const [suppressed] = await db.select().from(suppressions);
    expect(suppressed).toMatchObject({ userId: "user-1", source: "bounce", emailId: EMAIL_ID });
    // Neither the reason nor the row carries the address in clear.
    expect(JSON.stringify(suppressed)).not.toContain("ghost");
    expect(JSON.stringify(history)).not.toContain("ghost");
    expect(await suppressionService.findSuppression("user-1", "Ghost@Example.com")).not.toBeNull();
  });

  it("B2 — bad signature, stale timestamp, unknown or unconnected configuration: 401, nothing written", async () => {
    await connect("cfg-1", "resend", RESEND_SECRET);
    const body = resendBounce();

    const tampered = await post("cfg-1", body.replace("General", "NoEmail"), svixHeaders(body));
    const stale = await post("cfg-1", body, svixHeaders(body, "msg_1", Math.floor(Date.now() / 1000) - 600));
    const unsigned = await post("cfg-1", body, {});
    const unknown = await post("cfg-404", body, svixHeaders(body));
    const unconnected = await post("cfg-2", body, svixHeaders(body));

    for (const res of [tampered, stale, unsigned, unknown, unconnected]) expect(res.status).toBe(401);
    expect(await db.select().from(deliveryEvents)).toHaveLength(0);
    expect(await db.select().from(suppressions)).toHaveLength(0);
    expect((await historyOf(EMAIL_ID)).map((row) => row.status)).toEqual(["sent"]);
  });

  it("B3 — the same event delivered twice is applied once", async () => {
    await connect("cfg-1", "resend", RESEND_SECRET);
    const body = resendBounce();
    await post("cfg-1", body, svixHeaders(body, "msg_retry"));
    const retry = await post("cfg-1", body, svixHeaders(body, "msg_retry"));

    expect(await retry.json()).toMatchObject({ received: 1, duplicates: 1, matched: 0 });
    expect((await historyOf(EMAIL_ID)).map((row) => row.status)).toEqual(["sent", "bounced"]);
    expect(await db.select().from(deliveryEvents)).toHaveLength(1);
  });

  it("B4 — SendGrid: only dead-address bounces and complaints suppress", async () => {
    await connect("cfg-1", "sendgrid", SENDGRID_PUBLIC_KEY);
    const event = (id: string, email: string, fields: Record<string, unknown>) => ({
      email,
      timestamp: 1513299569,
      "smtp-id": "<14c5d75ce93.dfd.64b469@ismtpd-555>",
      sg_event_id: id,
      sg_message_id: "14c5d75ce93.dfd.64b469.filter0001.16648.5515E0B88.0",
      ...fields,
    });
    const body = JSON.stringify([
      event("e1", RECIPIENT, { event: "delivered", makisend_email_id: EMAIL_ID }),
      event("e2", "blocked@example.com", { event: "bounce", type: "blocked", status: "4.0.0", reason: "try later" }),
      event("e3", "policy@example.com", {
        event: "bounce",
        type: "bounce",
        status: "5.7.1",
        bounce_classification: "Reputation",
        reason: "550 5.7.1 policy@example.com blocked",
      }),
      event("e4", "dead@example.com", {
        event: "bounce",
        type: "bounce",
        status: "5.1.1",
        bounce_classification: "Invalid Address",
        reason: "550 5.1.1 unknown recipient",
      }),
      event("e5", "angry@example.com", { event: "spamreport" }),
      event("e6", "opened@example.com", { event: "open" }),
    ]);

    const res = await post("cfg-1", body, sendgridHeaders(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: 5, matched: 1, suppressed: 2 });

    expect((await historyOf(EMAIL_ID)).map((row) => row.status)).toEqual(["sent", "delivered"]);
    const rows = await db.select().from(suppressions);
    expect(rows.map((row) => [row.source, row.reason]).sort()).toEqual([
      ["bounce", "Hard bounce reported by SendGrid (Bounce · 5.1.1 · Invalid Address)"],
      ["complaint", "Spam complaint reported by SendGrid"],
    ]);
    expect(await suppressionService.findSuppression("user-1", "policy@example.com")).toBeNull();
    expect(await suppressionService.findSuppression("user-1", "blocked@example.com")).toBeNull();

    const forged = await post("cfg-1", body.replace("e5", "e7"), sendgridHeaders(body));
    expect(forged.status).toBe(401);
  });

  it("B5 — Mailgun with redacted recipients: the address comes from the matched log", async () => {
    await connect("cfg-1", "mailgun", MAILGUN_KEY);
    const failed = (id: string, severity: string, code: number, enhanced: string) =>
      JSON.stringify({
        signature: mailgunSignature(),
        "event-data": {
          event: "failed",
          id,
          severity,
          reason: "bounce",
          recipient: "[REDACTED]",
          message: { headers: { "message-id": `${EMAIL_ID}@shop.example` } },
          "user-variables": { makisend_email_id: EMAIL_ID },
          "delivery-status": { code, "enhanced-code": enhanced, "bounce-type": "hard", message: "mailbox unavailable" },
        },
      });

    const temporary = await post("cfg-1", failed("mg-1", "temporary", 421, "4.7.0"), {});
    expect(await temporary.json()).toMatchObject({ matched: 1, suppressed: 0 });
    const permanent = await post("cfg-1", failed("mg-2", "permanent", 550, "5.5.0"), {});
    expect(await permanent.json()).toMatchObject({ matched: 1, suppressed: 1 });

    expect((await historyOf(EMAIL_ID)).map((row) => row.status)).toEqual(["sent", "deferred", "bounced"]);
    expect(await suppressionService.findSuppression("user-1", RECIPIENT)).toMatchObject({ source: "bounce" });

    const wrongKey = JSON.stringify({ ...JSON.parse(failed("mg-3", "permanent", 550, "5.1.1")), signature: mailgunSignature("other") });
    expect((await post("cfg-1", wrongKey, {})).status).toBe(401);
  });

  it("B6 — Postmark: Basic auth password, hard bounce matched through metadata", async () => {
    await connect("cfg-1", "postmark", POSTMARK_PASSWORD);
    const body = JSON.stringify({
      RecordType: "Bounce",
      ID: 692560173,
      Type: "HardBounce",
      TypeCode: 1,
      MessageID: "883953f4-6105-42a2-a16a-77a8eac79483",
      Metadata: { "makisend-email-id": EMAIL_ID },
      Email: RECIPIENT,
      Details: `smtp;550 5.1.1 ${RECIPIENT} unknown`,
    });
    const auth = (password: string) => ({ Authorization: `Basic ${btoa(`postmark:${password}`)}` });

    expect((await post("cfg-1", body, auth("wrong-password-wrong-password"))).status).toBe(401);
    const res = await post("cfg-1", body, auth(POSTMARK_PASSWORD));
    expect(await res.json()).toMatchObject({ matched: 1, suppressed: 1 });
    const history = await historyOf(EMAIL_ID);
    expect(history.at(-1)).toMatchObject({ status: "bounced", error: "Hard bounce reported by Postmark (HardBounce · type 1)" });
  });

  it("B7 — another user's email, or another address than the log's, is never touched", async () => {
    await connect("cfg-1", "resend", RESEND_SECRET);
    const foreign = resendBounce({ message_id: `<${OTHER_USER_EMAIL_ID}@shop.example>`, to: ["someone@example.com"] });
    const mismatch = resendBounce({ to: ["someone-else@example.com"] });

    await post("cfg-1", foreign, svixHeaders(foreign, "msg_foreign"));
    await post("cfg-1", mismatch, svixHeaders(mismatch, "msg_mismatch"));

    expect((await historyOf(OTHER_USER_EMAIL_ID)).map((row) => row.status)).toEqual(["sent"]);
    expect((await historyOf(EMAIL_ID)).map((row) => row.status)).toEqual(["sent"]);
    // The provider still reported those addresses as dead for this configuration's owner.
    const rows = await db.select().from(suppressions);
    expect(rows.every((row) => row.userId === "user-1" && row.emailId === null)).toBe(true);
    expect(rows).toHaveLength(2);
  });

  it("B8 — saving a webhook checks the secret and never returns it; disconnecting refuses the provider", async () => {
    const service = new SmtpConfigService(new SmtpConfigRepository(db), KEYS);
    await expect(service.setBounceWebhook("cfg-1", "user-1", { provider: "resend", secret: "not-a-secret" })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(service.setBounceWebhook("cfg-1", "user-1", { provider: "sendgrid", secret: "AAAA" })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(service.setBounceWebhook("cfg-2", "user-1", { provider: "resend", secret: RESEND_SECRET })).rejects.toMatchObject({
      statusCode: 403,
    });

    const saved = await service.setBounceWebhook("cfg-1", "user-1", { provider: "resend", secret: ` ${RESEND_SECRET} ` });
    const published = toPublicSmtpConfig(saved);
    expect(published.bounceWebhookProvider).toBe("resend");
    expect(JSON.stringify(published)).not.toContain("whsec_");
    expect(JSON.stringify(published)).not.toContain("bounceWebhookSecret");

    const body = resendBounce();
    expect((await post("cfg-1", body, svixHeaders(body, "msg_a"))).status).toBe(200);
    await service.removeBounceWebhook("cfg-1", "user-1");
    expect((await post("cfg-1", body, svixHeaders(body, "msg_b"))).status).toBe(401);
  });

  it("B10 — the daily prune forgets events older than 30 days", async () => {
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    await db.insert(deliveryEvents).values([
      { smtpConfigId: "cfg-1", provider: "resend", eventKey: "old", kind: "delivered", createdAt: old },
      { smtpConfigId: "cfg-1", provider: "resend", eventKey: "new", kind: "delivered" },
    ]);
    expect(await runDeliveryEventsPrune({ makisend_db: d1 } as Bindings)).toBe(1);
    expect((await db.select().from(deliveryEvents)).map((row) => row.eventKey)).toEqual(["new"]);
  });
});

describe("B9 — what a send carries for the webhook", () => {
  let server: SMTPServer;
  let port = 0;
  const received: string[] = [];

  beforeAll(async () => {
    server = new SMTPServer({
      authOptional: true,
      onAuth(_auth, _session, callback) {
        callback(null, { user: "mailer" });
      },
      onData(stream, _session, callback) {
        let raw = "";
        stream.on("data", (chunk: Uint8Array) => (raw += new TextDecoder().decode(chunk)));
        stream.on("end", () => {
          received.push(raw);
          callback();
        });
      },
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.server.address();
    port = typeof address === "object" && address ? address.port : 0;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const transport = (bounceWebhookProvider: "sendgrid" | "postmark" | null) =>
    new SmtpEmailTransport(
      {
        smtpHostName: "127.0.0.1",
        smtpPort: port,
        smtpSecurity: "starttls",
        smtpUsername: "mailer",
        smtpPassword: "irrelevant",
        senderEmail: SENDER,
        bounceWebhookProvider,
      },
      { rejectUnauthorized: false },
    );
  const email = { to: RECIPIENT, subject: "Votre reçu", text: "Merci.", html: "<p>Merci.</p>" };

  it("sets Message-ID <emailId@sender-domain> and the provider's tag", async () => {
    const result = await transport("sendgrid").send({ ...email, emailId: EMAIL_ID });
    expect(result.messageId).toBe(`<${EMAIL_ID}@shop.example>`);
    const raw = received.at(-1)!;
    expect(raw).toMatch(new RegExp(`^Message-ID: <${EMAIL_ID}@shop\\.example>`, "mi"));
    expect(raw).toContain(`X-SMTPAPI: {"unique_args":{"makisend_email_id":"${EMAIL_ID}"}}`);
  });

  it("adds no tag without a webhook, and keeps a tag header the caller set", async () => {
    await transport(null).send({ ...email, emailId: EMAIL_ID });
    expect(received.at(-1)).not.toContain("X-SMTPAPI");
    expect(received.at(-1)).not.toContain("X-PM-Metadata");

    await transport("postmark").send({ ...email, emailId: EMAIL_ID, headers: { "x-pm-metadata-makisend-email-id": "mine" } });
    const raw = received.at(-1)!;
    expect(raw).toMatch(/^x-pm-metadata-makisend-email-id: mine$/im);
    expect(raw.match(/x-pm-metadata-makisend-email-id/gi)).toHaveLength(1);
  });
});
