/**
 * The published Docker image, end to end, with a real SMTP server.
 *
 * run-docker.sh starts the image next to Mailpit (a real SMTP server that answers STARTTLS with a
 * certificate signed by a throw-away CA, which the image is told to trust). Nothing is mocked: the
 * script uses the HTTP API like a user would, and reads what Mailpit received.
 *
 *   D1  A session can be created, an SMTP configuration saved and its connection checked.
 *   D2  The dashboard's test send reaches the SMTP server.
 *   D3  POST /send-email (API key, queue, workflow, SMTP) delivers a message with its attachment,
 *       and the email log ends on a sent status.
 *   D4  The cron scheduler entry point runs the SMTP health check.
 *   D5  After the container restarts, the volume still holds the account, the configuration and the
 *       log, and a new send still goes out.
 *
 * Usage: tsx test/e2e/docker.ts <before|after>   (env: BASE_URL, MAILPIT_URL, SMTP_HOST, STATE_FILE)
 */
import { readFileSync, writeFileSync } from "node:fs";

const phase = process.argv[2] ?? "before";
const base = process.env.BASE_URL ?? "http://127.0.0.1:18787";
const mailpit = process.env.MAILPIT_URL ?? "http://127.0.0.1:18025";
const smtpHost = process.env.SMTP_HOST ?? "smtp.example.test";
const stateFile = process.env.STATE_FILE ?? "/tmp/makisend-docker-e2e.json";
const origin = new URL(base).origin;

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) failed++;
  process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}\n`);
}

/** The fields of the API answers this test reads. */
interface Json {
  needsSetup?: boolean;
  ok?: boolean;
  key?: string;
  raw?: string;
  config?: { id?: string };
  configs?: { id: string; lastCheckAt: string | null; lastCheckOk: boolean | null }[];
  logs?: { subject: string; history: { status: string }[] }[];
}

let cookie = "";
async function call(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await fetch(`${base}${path}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", origin, ...(cookie ? { cookie } : {}), ...init.headers },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length > 0) cookie = set.map((c) => c.split(";")[0]).join("; ");
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) as Json };
  } catch {
    return { status: res.status, json: { raw: text } as Json };
  }
}

interface MailpitMessage {
  ID: string;
  Subject: string;
  Attachments: number;
  From: { Address: string };
  To: { Address: string }[];
}
async function mailpitMessages(): Promise<MailpitMessage[]> {
  const res = await fetch(`${mailpit}/api/v1/messages`);
  return ((await res.json()) as { messages: MailpitMessage[] }).messages;
}
async function waitForMessage(subject: string, seconds: number): Promise<MailpitMessage | undefined> {
  for (let i = 0; i < seconds * 2; i++) {
    const found = (await mailpitMessages()).find((m) => m.Subject === subject);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 500));
  }
  return undefined;
}

const CSV = "ref,amount\nREC-1,5000\n";
async function sendWithApi(apiKey: string, subject: string): Promise<number> {
  const res = await call("/send-email", {
    method: "POST",
    headers: { "x-api-key": apiKey, cookie: "" },
    body: {
      to: "dest@example.test",
      subject,
      text: "Your payment is confirmed. The receipt is attached.",
      html: "<p>Your payment is confirmed.</p>",
      attachments: [{ filename: "detail.csv", content: Buffer.from(CSV).toString("base64") }],
    },
  });
  return res.status;
}

async function waitForLogStatus(subject: string, status: string, seconds: number): Promise<boolean> {
  for (let i = 0; i < seconds * 2; i++) {
    const { json } = await call("/email-logs");
    const log = json.logs?.find((l) => l.subject === subject);
    if (log?.history.some((h) => h.status === status)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function before(): Promise<void> {
  const email = `e2e-${Date.now().toString(36)}@example.test`;
  const password = `pw-${crypto.randomUUID()}`;

  const status = await call("/api/setup-status");
  check("D1 a fresh instance asks for its first account", status.json.needsSetup === true, JSON.stringify(status.json));

  const signUp = await call("/api/auth/sign-up/email", { method: "POST", body: { email, password, name: "E2E" } });
  check("D1 the administrator can be created", signUp.status === 200, String(signUp.status));

  const created = await call("/smtp-config", {
    method: "POST",
    body: { smtpHostname: smtpHost, smtpPort: 587, smtpUsername: "user", smtpPassword: "pass", senderEmail: "noreply@example.test" },
  });
  const configId = created.json.config?.id;
  check("D1 an SMTP configuration can be saved", Boolean(configId), `${created.status} ${JSON.stringify(created.json)}`);
  if (!configId) return;

  const connection = await call(`/smtp-config/${configId}/check`, { method: "POST" });
  check("D1 the SMTP connection check passes (STARTTLS, verified certificate)", connection.status === 200 && connection.json.ok === true, JSON.stringify(connection.json));

  const test = await call(`/smtp-config/${configId}/test-send`, { method: "POST", body: { to: "dest@example.test" } });
  const testMail = await waitForMessage("MakiSend test email", 20);
  check("D2 the dashboard test send reaches the SMTP server", test.status === 200 && Boolean(testMail), `${test.status}`);

  const key = await call("/api-keys", { method: "POST", body: { smtpConfigId: configId, name: "e2e" } });
  const apiKey = key.json.key;
  if (!apiKey) throw new Error(`api-keys answered ${key.status}: ${JSON.stringify(key.json)}`);

  const subject = "Receipt REC-1";
  const accepted = await sendWithApi(apiKey, subject);
  const mail = await waitForMessage(subject, 60);
  check("D3 POST /send-email answers 202", accepted === 202, String(accepted));
  check("D3 the message arrives with the right sender and recipient", mail?.From.Address === "noreply@example.test" && mail?.To[0]?.Address === "dest@example.test", JSON.stringify(mail));
  if (mail) {
    const detail = (await (await fetch(`${mailpit}/api/v1/message/${mail.ID}`)).json()) as {
      Text: string;
      HTML: string;
      Attachments: { FileName: string; Size: number }[];
    };
    check("D3 text and html bodies are intact", detail.Text.includes("payment is confirmed") && detail.HTML.includes("<p>Your payment"), "");
    check("D3 the attachment is delivered with its exact size", detail.Attachments[0]?.FileName === "detail.csv" && detail.Attachments[0]?.Size === CSV.length, JSON.stringify(detail.Attachments));
  }
  check("D3 the email log records a sent status", await waitForLogStatus(subject, "sent", 20), "");

  const lastCheck = async (): Promise<{ at: string | null; ok: boolean | null }> => {
    const { json } = await call("/smtp-config");
    const config = json.configs?.[0];
    return { at: config?.lastCheckAt ?? null, ok: config?.lastCheckOk ?? null };
  };
  const previous = await lastCheck();
  const cron = await fetch(`${base}/cdn-cgi/handler/scheduled?cron=17+3+*+*+*`);
  let checked = false;
  for (let i = 0; i < 30 && !checked; i++) {
    const now = await lastCheck();
    checked = now.at !== null && now.at !== previous.at && now.ok === true;
    if (!checked) await new Promise((r) => setTimeout(r, 500));
  }
  check("D4 the scheduled handler runs a new SMTP health check", cron.status === 200 && checked, String(cron.status));

  writeFileSync(stateFile, JSON.stringify({ email, password, configId, apiKey }));
}

async function after(): Promise<void> {
  const saved = JSON.parse(readFileSync(stateFile, "utf8")) as { email: string; password: string; configId: string; apiKey: string };

  const status = await call("/api/setup-status");
  check("D5 the account survived the restart", status.json.needsSetup === false, JSON.stringify(status.json));
  const signIn = await call("/api/auth/sign-in/email", { method: "POST", body: { email: saved.email, password: saved.password } });
  check("D5 the administrator can still sign in", signIn.status === 200, String(signIn.status));
  const configs = await call("/smtp-config");
  check("D5 the SMTP configuration survived", configs.json.configs?.some((c) => c.id === saved.configId) === true, "");
  const logs = await call("/email-logs");
  check("D5 the email log survived", logs.json.logs?.some((l) => l.subject === "Receipt REC-1") === true, "");

  const subject = "After restart";
  const accepted = await sendWithApi(saved.apiKey, subject);
  const mail = await waitForMessage(subject, 60);
  check("D5 the old API key still sends, and the mail goes out", accepted === 202 && Boolean(mail), String(accepted));
}

(phase === "after" ? after() : before())
  .then(() => {
    process.stdout.write(`\n${failed === 0 ? "All checks passed" : `${failed} check(s) failed`} (${phase})\n`);
    process.exit(failed === 0 ? 0 : 1);
  })
  .catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    process.exit(1);
  });
