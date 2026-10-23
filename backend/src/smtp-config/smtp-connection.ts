import * as net from "node:net";
import * as tls from "node:tls";
import * as nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { SmtpConfig } from "@/config/config";
import { pinoLogger } from "@/core/logger";
import { DEFAULT_SMTP_PORT, type SmtpSecurity } from "./smtp-host";

export const SMTP_CONNECTION_TIMEOUT_MS = 10_000;
export const SMTP_GREETING_TIMEOUT_MS = 10_000;
export const SMTP_SOCKET_TIMEOUT_MS = 20_000;

type SocketResult = { connection: net.Socket; secured?: boolean };
type SocketCallback = (err: Error | null, socketOptions: SocketResult | false) => void;

export interface SmtpTransportOptions {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  auth: { user: string; pass: string };
  family: 4;
  tls: { rejectUnauthorized: boolean };
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
  getSocket: (options: unknown, callback: SocketCallback) => void;
}

function connectByName(
  host: string,
  port: number,
  security: SmtpSecurity,
  rejectUnauthorized: boolean,
  timeoutMs: number,
): (options: unknown, callback: SocketCallback) => void {
  return (_options, callback) => {
    let settled = false;
    const socket: net.Socket =
      security === "tls"
        ? tls.connect({ host, port, rejectUnauthorized, ...(net.isIP(host) ? {} : { servername: host }) })
        : net.connect({ host, port });

    const settle = (err: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeListener("error", settle);
      if (err) {
        socket.destroy();
        return callback(err, false);
      }
      socket.setKeepAlive(true);
      callback(null, security === "tls" ? { connection: socket, secured: true } : { connection: socket });
    };

    const timer = setTimeout(() => {
      settle(Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT" }));
    }, timeoutMs);

    socket.once("error", settle);
    socket.once(security === "tls" ? "secureConnect" : "connect", () => settle(null));
  };
}

export function buildSmtpTransportOptions(
  smtp: Pick<SmtpConfig, "smtpHostName" | "smtpUsername" | "smtpPassword" | "smtpPort" | "smtpSecurity">,
  options: { rejectUnauthorized?: boolean } = {},
): SmtpTransportOptions {
  const security: SmtpSecurity = smtp.smtpSecurity ?? "tls";
  const port = smtp.smtpPort ?? DEFAULT_SMTP_PORT;
  const rejectUnauthorized = options.rejectUnauthorized ?? true;
  return {
    host: smtp.smtpHostName,
    port,
    secure: security === "tls",
    requireTLS: security === "starttls",
    auth: { user: smtp.smtpUsername, pass: smtp.smtpPassword },
    family: 4,
    tls: { rejectUnauthorized },
    connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
    socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
    getSocket: connectByName(smtp.smtpHostName, port, security, rejectUnauthorized, SMTP_CONNECTION_TIMEOUT_MS),
  };
}

export function createSmtpTransport(
  smtp: Pick<SmtpConfig, "smtpHostName" | "smtpUsername" | "smtpPassword" | "smtpPort" | "smtpSecurity">,
  options: { rejectUnauthorized?: boolean } = {},
): Transporter {
  return nodemailer.createTransport(buildSmtpTransportOptions(smtp, options));
}

export type SmtpCheckFailure =
  | "host_not_found"
  | "connection_refused"
  | "connection_timeout"
  | "cannot_connect"
  | "tls_mismatch"
  | "certificate"
  | "starttls_unavailable"
  | "authentication"
  | "rejected"
  | "unknown";

export type SmtpCheckResult =
  | { ok: true }
  | { ok: false; reason: SmtpCheckFailure; message: string };

interface NodemailerError {
  code?: unknown;
  responseCode?: unknown;
  response?: unknown;
  message?: unknown;
}

function serverReply(response: unknown): string {
  if (typeof response !== "string") return "";
  // eslint-disable-next-line no-control-regex
  const oneLine = response.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return oneLine.length > 200 ? `${oneLine.slice(0, 200)}...` : oneLine;
}

const TLS_VERSION_ERRORS = /wrong version number|packet length too long|unknown protocol|ssl routines|record layer/i;
const CERTIFICATE_ERRORS = /certificate|self[- ]signed|hostname\/ip does not match|altnames|unable to verify/i;

export function classifySmtpError(
  err: unknown,
  security: SmtpSecurity,
  port: number,
): Extract<SmtpCheckResult, { ok: false }> {
  const { code, responseCode, message } = (typeof err === "object" && err !== null ? err : {}) as NodemailerError;
  const text = typeof message === "string" ? message : String(err);

  if (code === "EAUTH" || responseCode === 535 || responseCode === 534 || responseCode === 454) {
    return {
      ok: false,
      reason: "authentication",
      message: "The server refused the user name or the password. Check them, and whether the provider wants an app-specific password.",
    };
  }
  if (
    code === "EENVELOPE" ||
    code === "EMESSAGE" ||
    (typeof responseCode === "number" && responseCode >= 550 && responseCode <= 554)
  ) {
    const reply = serverReply((err as NodemailerError).response);
    return {
      ok: false,
      reason: "rejected",
      message: `The server accepted the connection and the login but refused the message${reply ? `: "${reply}"` : ""}. Check that the sender address is allowed by your provider and that the recipient is valid.`,
    };
  }

  const errno = (name: string) => code === name || new RegExp(`\\b${name}\\b`).test(text);

  if (errno("ENOTFOUND") || errno("EDNS") || errno("ENODATA") || errno("EAI_AGAIN")) {
    return { ok: false, reason: "host_not_found", message: "That server name does not exist. Check the spelling of the hostname." };
  }
  if (errno("ECONNREFUSED")) {
    return {
      ok: false,
      reason: "connection_refused",
      message: `The server is there but nothing listens on port ${port}. Check the port.`,
    };
  }
  if (errno("ETIMEDOUT") || /timed? ?out|timeout/i.test(text)) {
    return {
      ok: false,
      reason: "connection_timeout",
      message: `No answer from the server on port ${port}. The port may be blocked or the server unreachable.`,
    };
  }
  if (TLS_VERSION_ERRORS.test(text)) {
    return {
      ok: false,
      reason: "tls_mismatch",
      message:
        security === "tls"
          ? `Port ${port} does not speak TLS from the first byte. Use "starttls" (usually port 587), or port 465 for "tls".`
          : `Port ${port} expects TLS from the first byte. Use "tls" (port 465), or "starttls" on port 587.`,
    };
  }
  if (CERTIFICATE_ERRORS.test(text)) {
    return {
      ok: false,
      reason: "certificate",
      message: "The server's certificate is not valid for that hostname. Use the exact name the provider gives (not an IP address).",
    };
  }
  if (/STARTTLS/i.test(text)) {
    return {
      ok: false,
      reason: "starttls_unavailable",
      message: `The server does not offer STARTTLS on port ${port}. Try "tls" on port 465.`,
    };
  }
  if (/cannot connect to the specified address|proxy request failed|connect failed|socket/i.test(text)) {
    return {
      ok: false,
      reason: "cannot_connect",
      message:
        port === 25
          ? "The Worker could not open a connection to that address and port. Check the hostname and the port; outbound port 25 is blocked on Cloudflare Workers."
          : `The Worker could not open a connection to that server on port ${port}. Check the hostname and the port.`,
    };
  }
  return { ok: false, reason: "unknown", message: "The connection failed for a reason this check does not recognise." };
}

function logSmtpFailure(
  operation: string,
  err: unknown,
  failure: SmtpCheckFailure,
  smtp: Pick<SmtpConfig, "smtpHostName" | "smtpPassword">,
  port: number,
): void {
  const { code, responseCode, message } = (typeof err === "object" && err !== null ? err : {}) as NodemailerError;
  const raw = typeof message === "string" ? message : String(err);
  const detail = smtp.smtpPassword ? raw.split(smtp.smtpPassword).join("[redacted]") : raw;
  pinoLogger.warn({ operation, reason: failure, code, responseCode, host: smtp.smtpHostName, port, detail }, "SMTP operation failed");
}

export async function checkSmtpConnection(
  smtp: Pick<SmtpConfig, "smtpHostName" | "smtpUsername" | "smtpPassword" | "smtpPort" | "smtpSecurity">,
  options: { rejectUnauthorized?: boolean } = {},
): Promise<SmtpCheckResult> {
  const transporter = createSmtpTransport(smtp, options);
  const port = smtp.smtpPort ?? DEFAULT_SMTP_PORT;
  try {
    await transporter.verify();
    return { ok: true };
  } catch (err) {
    const failure = classifySmtpError(err, smtp.smtpSecurity ?? "tls", port);
    logSmtpFailure("check", err, failure.reason, smtp, port);
    return failure;
  } finally {
    transporter.close();
  }
}

export interface TestEmail {
  to: string;
  subject: string;
  text: string;
}

export type SmtpSendResult = { ok: true; messageId: string } | Extract<SmtpCheckResult, { ok: false }>;

export async function sendTestEmail(
  smtp: Pick<SmtpConfig, "smtpHostName" | "smtpUsername" | "smtpPassword" | "smtpPort" | "smtpSecurity" | "senderEmail">,
  email: TestEmail,
  options: { rejectUnauthorized?: boolean } = {},
): Promise<SmtpSendResult> {
  const transporter = createSmtpTransport(smtp, options);
  const port = smtp.smtpPort ?? DEFAULT_SMTP_PORT;
  try {
    const info = await transporter.sendMail({
      from: smtp.senderEmail,
      to: email.to,
      subject: email.subject,
      text: email.text,
    });
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    const failure = classifySmtpError(err, smtp.smtpSecurity ?? "tls", port);
    logSmtpFailure("test-send", err, failure.reason, smtp, port);
    return failure;
  } finally {
    transporter.close();
  }
}
