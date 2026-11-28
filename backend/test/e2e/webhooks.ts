/**
 * Signed webhooks, end to end, through the running Worker (`wrangler dev`): the dashboard routes
 * (session), POST /send-email (API key) → send queue → Workflow → publication → webhooks queue →
 * consumer → a signed POST to a real HTTP receiver started here, which verifies every request
 * with the official `standardwebhooks` library. Nothing is mocked.
 *
 * Written from the ways it could fail:
 *   W1  The endpoint cannot be created, or its secret leaks in a read.
 *   W2  The test route does not reach the receiver, or its signature does not verify.
 *   W3  A sent email produces no webhook, two webhooks, or one the receiver cannot verify.
 *   W4  A receiver that fails once is never retried, or retried under a new webhook-id.
 *   W5  A dashboard test send (source = "test") publishes a webhook.
 *   W6  The deliveries log does not show what happened.
 *
 * Artefact: test/e2e/reports/webhooks.json (deterministic: statuses, counts, event types).
 * Run: test/e2e/run-webhooks.sh   (starts wrangler dev and calls this with the env below)
 * Env: BASE_URL, ORIGIN, RECEIVER_PORT.
 */
import { createServer, type IncomingMessage } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Webhook } from "standardwebhooks";

const base = process.env.BASE_URL ?? "http://127.0.0.1:8789";
const origin = process.env.ORIGIN ?? "http://localhost:8789";
const receiverPort = Number(process.env.RECEIVER_PORT ?? 9999);

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}
const checks: Check[] = [];
function check(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
  process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}\n`);
}

// --- The receiver: what a MakiSend user would run on their side. ---

interface Received {
  id: string;
  verified: boolean;
  type: string | null;
  data: Record<string, unknown>;
  answered: number;
}
const received: Received[] = [];
let secret = "";
/** Status codes to answer next, in order; empty = 200. */
const failNext: number[] = [];

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

const receiver = createServer(async (req, res) => {
  const raw = await readBody(req); // the RAW body: never parse and re-serialize before verifying
  const headers = {
    "webhook-id": String(req.headers["webhook-id"] ?? ""),
    "webhook-timestamp": String(req.headers["webhook-timestamp"] ?? ""),
    "webhook-signature": String(req.headers["webhook-signature"] ?? ""),
  };
  let verified = false;
  let event: { type?: string; data?: Record<string, unknown> } = {};
  try {
    event = new Webhook(secret).verify(raw, headers) as typeof event;
    verified = true;
  } catch {
    // Bad signature: `verified` stays false and the event stays empty.
  }
  const answered = failNext.shift() ?? 200;
  received.push({ id: headers["webhook-id"], verified, type: event.type ?? null, data: event.data ?? {}, answered });
  res.writeHead(answered).end();
});

// --- The MakiSend API. ---

let cookie = "";
async function call(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await fetch(`${base}${path}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", origin, ...(cookie ? { cookie } : {}), ...init.headers },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length > 0) cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json, text };
}

async function waitFor<T>(read: () => T | Promise<T>, done: (value: T) => boolean, seconds: number): Promise<T> {
  let value = await read();
  for (let i = 0; i < seconds * 2 && !done(value); i++) {
    await new Promise((r) => setTimeout(r, 500));
    value = await read();
  }
  return value;
}

const forEmail = (emailId: string) => received.filter((r) => r.data.emailId === emailId);

async function main(): Promise<void> {
  await new Promise<void>((resolve) => receiver.listen(receiverPort, "127.0.0.1", resolve));
  const report: Record<string, unknown> = {};

  const signUp = await call("/api/auth/sign-up/email", {
    method: "POST",
    body: { email: `e2e-${Date.now().toString(36)}@example.test`, password: `pw-${crypto.randomUUID()}`, name: "E2E" },
  });
  if (signUp.status !== 200) throw new Error(`sign-up answered ${signUp.status}: ${JSON.stringify(signUp.json)}`);

  const config = await call("/smtp-config", {
    method: "POST",
    body: {
      smtpHostname: "smtp.mx.cloudflare.net",
      smtpPort: 587,
      smtpUsername: "e2e",
      smtpPassword: "e2e-not-a-real-password",
      senderEmail: "noreply@example.test",
    },
  });
  const configId = (config.json as { config?: { id?: string } }).config?.id;
  if (!configId) throw new Error(`smtp-config answered ${config.status}: ${JSON.stringify(config.json)}`);
  const key = await call("/api-keys", { method: "POST", body: { smtpConfigId: configId, name: "e2e" } });
  const apiKey = (key.json as { key?: string }).key;
  if (!apiKey) throw new Error(`api-keys answered ${key.status}: ${JSON.stringify(key.json)}`);

  // W1 — create the endpoint; the secret is shown once and never again.
  const created = await call("/webhooks", { method: "POST", body: { url: `http://127.0.0.1:${receiverPort}/hook` } });
  const body = created.json as { endpoint?: { id: string }; secret?: string };
  secret = body.secret ?? "";
  const endpointId = body.endpoint?.id ?? "";
  check("W1 POST /webhooks answers 201 with a whsec_ secret", created.status === 201 && secret.startsWith("whsec_"), `${created.status}`);
  const list = await call("/webhooks");
  check("W1 the secret is in no read", list.status === 200 && !list.text.includes("whsec_"), `GET /webhooks ${list.status}`);
  report.W1 = { created: created.status, listed: list.status };

  // W2 — the test route reaches the receiver, signed.
  const test = await call(`/webhooks/${endpointId}/test`, { method: "POST" });
  const testEvent = received.find((r) => r.type === "webhook.test");
  check("W2 POST /webhooks/:id/test answers ok", test.status === 200 && (test.json as { ok?: boolean }).ok === true, test.text);
  check("W2 the receiver got a webhook.test that verifies", testEvent?.verified === true, JSON.stringify(testEvent ?? null));
  report.W2 = { status: test.status, ok: (test.json as { ok?: boolean }).ok, verified: testEvent?.verified ?? false };

  // W3 — a real email: exactly one email.sent, verified, about this email.
  const send = await call("/send-email", {
    method: "POST",
    headers: { "x-api-key": apiKey, cookie: "" },
    body: { to: "dest@example.test", subject: "Votre facture", text: "Bonjour, voici votre facture.", html: "<p>Bonjour, voici votre facture.</p>" },
  });
  const emailId = (send.json as { emailId?: string; id?: string }).emailId ?? (send.json as { id?: string }).id ?? "";
  check("W3 /send-email answers 202", send.status === 202 && emailId.length > 0, send.text);
  const sentEvents = await waitFor(() => forEmail(emailId), (v) => v.length >= 1, 60);
  await new Promise((r) => setTimeout(r, 3000)); // a duplicate would arrive right after
  const sentAfter = forEmail(emailId);
  check(
    "W3 one email.sent, verified, carrying the email's id and status",
    sentAfter.length === 1 && sentEvents[0]?.verified === true && sentEvents[0]?.type === "email.sent" && sentEvents[0]?.data.status === "sent",
    JSON.stringify(sentAfter.map((r) => ({ type: r.type, verified: r.verified, status: r.data.status }))),
  );
  check("W3 the payload has the recipient and subject, no body", sentEvents[0]?.data.to === "dest@example.test" && sentEvents[0]?.data.subject === "Votre facture" && !JSON.stringify(sentEvents[0]?.data).includes("Bonjour"), "");
  report.W3 = { received: sentAfter.length, type: sentEvents[0]?.type ?? null, verified: sentEvents[0]?.verified ?? false };

  // W4 — the receiver fails once (500): retried ~60 s later, same webhook-id, then delivered.
  failNext.push(500);
  const second = await call("/send-email", {
    method: "POST",
    headers: { "x-api-key": apiKey, cookie: "" },
    body: { to: "dest@example.test", subject: "Retry me", text: "Second email, retried once.", html: "<p>Second email, retried once.</p>" },
  });
  const secondId = (second.json as { emailId?: string }).emailId ?? "";
  const attempts = await waitFor(() => forEmail(secondId), (v) => v.length >= 2, 120);
  check(
    "W4 a 500 is retried with the same webhook-id, then delivered",
    attempts.length === 2 && attempts[0].answered === 500 && attempts[1].answered === 200 && attempts[0].id === attempts[1].id && attempts.every((a) => a.verified),
    JSON.stringify(attempts.map((a) => ({ answered: a.answered, verified: a.verified, sameId: a.id === attempts[0]?.id }))),
  );
  report.W4 = { attempts: attempts.map((a) => a.answered), sameWebhookId: attempts.length === 2 && attempts[0].id === attempts[1].id };

  // W5 — a dashboard test send publishes nothing.
  const before = received.length;
  const dashboardTest = await call(`/smtp-config/${configId}/test-send`, { method: "POST", body: { to: "dest@example.test" } });
  await new Promise((r) => setTimeout(r, 5000));
  check("W5 a dashboard test send triggers no webhook", dashboardTest.status === 200 && received.length === before, `${received.length - before} received`);
  report.W5 = { status: dashboardTest.status, received: received.length - before };

  // W6 — the log shows it all.
  const log = await call(`/webhooks/${endpointId}/deliveries?limit=100`);
  const deliveries = (log.json as { deliveries?: { eventType: string; status: string; attempts: number }[] }).deliveries ?? [];
  const summary = deliveries.map((d) => `${d.eventType}:${d.status}:${d.attempts}`).sort();
  check(
    "W6 the log lists the test and the two emails, all delivered",
    JSON.stringify(summary) === JSON.stringify(["email.sent:delivered:1", "email.sent:delivered:2", "webhook.test:delivered:1"]),
    JSON.stringify(summary),
  );
  report.W6 = summary;

  report.checks = checks.map(({ name, ok }) => ({ name, ok }));
  const dir = join(import.meta.dirname, "reports");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "webhooks.json"), `${JSON.stringify(report, null, 2)}\n`);

  receiver.close();
  const failed = checks.filter((c) => !c.ok).length;
  process.stdout.write(`\n${checks.length - failed}/${checks.length} checks passed — report: test/e2e/reports/webhooks.json\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  receiver.close();
  process.exit(1);
});
