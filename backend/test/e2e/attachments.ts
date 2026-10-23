/**
 * Attachments, end to end, through the running Worker (`wrangler dev`, local D1, Queues and
 * Workflows) — the two ways a file leaves:
 *
 *   1. the dashboard's test send   POST /smtp-config/:id/test-send   (a session, like the dialog);
 *   2. the API                     POST /send-email                  (an API key) → queue → workflow.
 *
 * The configuration points at Cloudflare Email Service (smtp.mx.cloudflare.net), so both go through
 * the Worker's `send_email` binding. Locally, Miniflare writes every attachment it is handed to a file
 * and logs `Attachment (attachment): <name> -> <path>` in the wrangler log: this script reads those
 * files back and compares them byte for byte with what it sent. Nothing is mocked.
 *
 * Written from the ways it could fail:
 *   E1  The dashboard's test send drops the file, or alters it.
 *   E2  The API path (queue + workflow, bodies rebuilt from D1) drops the file, or alters it.
 *   E3  The order, the name or the type changes on the way.
 *   E4  A file the API refuses (not base64, CR/LF in the name, a URL to fetch) is accepted by the
 *       test send, or the other way round: both doors must say 400.
 *   E5  A message without attachments now leaves with an empty attachment list.
 *
 * Artefact: test/e2e/reports/attachments.json (deterministic: hashes, names, types, statuses —
 * no ids, no paths, no dates), for a later run to diff.
 *
 * Run: test/e2e/run-attachments.sh   (starts wrangler dev and calls this with the env below)
 * Env: BASE_URL, ORIGIN, WRANGLER_LOG.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const base = process.env.BASE_URL ?? "http://127.0.0.1:8788";
const origin = process.env.ORIGIN ?? "http://localhost:8788";
const wranglerLog = process.env.WRANGLER_LOG ?? "";

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

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex").slice(0, 16);
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/** A "PDF" holding every byte value, so any lossy encoding on the way shows up. */
const PDF = new Uint8Array(Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from(Uint8Array.from({ length: 4096 }, (_, i) => i % 256))]));
const CSV = new TextEncoder().encode("ref,amount\nREC-1,5000\n");
const FILES = [
  { filename: "recu-REC-1.pdf", content: b64(PDF), content_type: "application/pdf", bytes: PDF },
  { filename: "detail.csv", content: b64(CSV), bytes: CSV },
];
const sent = FILES.map((f) => ({ filename: f.filename, sha: sha(f.bytes), size: f.bytes.length }));
const wire = FILES.map(({ bytes: _bytes, ...rest }) => rest);

let cookie = "";
async function call(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await fetch(`${base}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "content-type": "application/json",
      origin,
      ...(cookie ? { cookie } : {}),
      ...init.headers,
    },
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
  return { status: res.status, json };
}

/** The attachment lines Miniflare logged after `offset`, read back from the files it wrote. */
function loggedAttachments(offset: number): { filename: string; sha: string; size: number }[] {
  const log = readFileSync(wranglerLog, "utf8").slice(offset).replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");
  const found: { filename: string; sha: string; size: number }[] = [];
  for (const match of log.matchAll(/Attachment \(attachment\): (.+?) -> (\S+)/g)) {
    const path = match[2]!.trim();
    const bytes = existsSync(path) ? new Uint8Array(readFileSync(path)) : new Uint8Array();
    found.push({ filename: match[1]!.trim(), sha: sha(bytes), size: bytes.length });
  }
  return found;
}
const logSize = () => readFileSync(wranglerLog, "utf8").length;
const bindingCalls = (offset: number) =>
  (readFileSync(wranglerLog, "utf8").slice(offset).match(/send_email binding called/g) ?? []).length;

async function waitFor<T>(read: () => T, done: (value: T) => boolean, seconds: number): Promise<T> {
  let value = read();
  for (let i = 0; i < seconds * 2 && !done(value); i++) {
    await new Promise((r) => setTimeout(r, 500));
    value = read();
  }
  return value;
}

async function main(): Promise<void> {
  const report: Record<string, unknown> = { sent };

  // A session, the way the dashboard has one.
  const signUp = await call("/api/auth/sign-up/email", {
    method: "POST",
    body: { email: `e2e-${Date.now().toString(36)}@example.test`, password: `pw-${crypto.randomUUID()}`, name: "E2E" },
  });
  if (signUp.status !== 200) throw new Error(`sign-up answered ${signUp.status}: ${JSON.stringify(signUp.json)}`);

  const created = await call("/smtp-config", {
    method: "POST",
    body: {
      smtpHostname: "smtp.mx.cloudflare.net",
      smtpPort: 587,
      smtpUsername: "e2e",
      smtpPassword: "e2e-not-a-real-password",
      senderEmail: "noreply@example.test",
    },
  });
  const configId = (created.json as { config?: { id?: string } }).config?.id;
  if (!configId) throw new Error(`smtp-config answered ${created.status}: ${JSON.stringify(created.json)}`);

  // E1 / E3 — the dashboard's test send, with two files.
  let mark = logSize();
  const test = await call(`/smtp-config/${configId}/test-send`, {
    method: "POST",
    body: { to: "dest@example.test", subject: "Test with files", text: "Two files attached.", attachments: wire },
  });
  const testOut = await waitFor(() => loggedAttachments(mark), (v) => v.length >= sent.length, 15);
  check("E1 test send answers ok", test.status === 200 && (test.json as { ok?: boolean }).ok === true, `${test.status} ${JSON.stringify(test.json)}`);
  check("E1/E3 test send: the binding received both files, byte for byte, in order", JSON.stringify(testOut) === JSON.stringify(sent), JSON.stringify(testOut));
  report["E1:test-send"] = { status: test.status, ok: (test.json as { ok?: boolean }).ok, received: testOut };

  // E5 — no attachment: the binding is called, and no file is written.
  mark = logSize();
  const plain = await call(`/smtp-config/${configId}/test-send`, { method: "POST", body: { to: "dest@example.test" } });
  await waitFor(() => bindingCalls(mark), (n) => n >= 1, 15);
  const plainOut = loggedAttachments(mark);
  check("E5 a test send without files carries none", plain.status === 200 && bindingCalls(mark) === 1 && plainOut.length === 0, `${plain.status}, ${plainOut.length} file(s)`);
  report["E5:no-attachment"] = { status: plain.status, files: plainOut.length };

  // E2 / E3 — the API: an API key, POST /send-email, then the queue and the workflow.
  const key = await call("/api-keys", { method: "POST", body: { smtpConfigId: configId, name: "e2e" } });
  const apiKey = (key.json as { key?: string }).key;
  if (!apiKey) throw new Error(`api-keys answered ${key.status}: ${JSON.stringify(key.json)}`);
  mark = logSize();
  const api = await call("/send-email", {
    method: "POST",
    headers: { "x-api-key": apiKey, cookie: "" },
    body: { to: "dest@example.test", subject: "Votre reçu REC-1", text: "Votre paiement est confirmé. Le reçu est joint.", html: "<p>Votre paiement est confirmé.</p>", attachments: wire },
  });
  const apiOut = await waitFor(() => loggedAttachments(mark), (v) => v.length >= sent.length, 45);
  check("E2 /send-email answers 202", api.status === 202, `${api.status} ${JSON.stringify(api.json)}`);
  check("E2/E3 /send-email: the workflow handed both files to the binding, byte for byte, in order", JSON.stringify(apiOut) === JSON.stringify(sent), JSON.stringify(apiOut));
  report["E2:send-email"] = { status: api.status, received: apiOut };

  // E4 — both doors refuse the same bad files.
  const bad: Record<string, unknown> = {
    "not base64": [{ filename: "a.pdf", content: "not base64!!" }],
    "CRLF in the name": [{ filename: "a.pdf\r\nBcc: x@example.test", content: b64(CSV) }],
    "a URL to fetch": [{ filename: "a.pdf", path: "https://example.com/a.pdf" }],
  };
  const verdicts: Record<string, { testSend: number; sendEmail: number }> = {};
  for (const [name, attachments] of Object.entries(bad)) {
    const t = await call(`/smtp-config/${configId}/test-send`, { method: "POST", body: { to: "dest@example.test", attachments } });
    const a = await call("/send-email", {
      method: "POST",
      headers: { "x-api-key": apiKey, cookie: "" },
      body: { to: "dest@example.test", subject: "Refused", text: "This one must be refused.", html: "<p>x</p>", attachments },
    });
    verdicts[name] = { testSend: t.status, sendEmail: a.status };
  }
  check("E4 both doors refuse the same files with 400", Object.values(verdicts).every((v) => v.testSend === 400 && v.sendEmail === 400), JSON.stringify(verdicts));
  report["E4:refusals"] = verdicts;

  report.checks = checks.map(({ name, ok }) => ({ name, ok }));
  const dir = join(import.meta.dirname, "reports");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "attachments.json"), `${JSON.stringify(report, null, 2)}\n`);

  const failed = checks.filter((c) => !c.ok).length;
  process.stdout.write(`\n${checks.length - failed}/${checks.length} checks passed — report: test/e2e/reports/attachments.json\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
