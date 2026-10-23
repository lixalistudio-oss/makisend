/**
 * Classifies a failed send-email run AFTER it dies (retries exhausted or the
 * 30s execution budget blown). The verdict decides whether `onFailure` gives
 * up permanently or bounces the message back onto the Cloudflare Queue.
 *
 * Only fields that survive Inngest's error serialization are read: `name`,
 * `message`, `stack`, `code` and `cause`. Nodemailer's `responseCode` and
 * `command` are stripped during transport, so the SMTP status a server
 * actually replied with (e.g. "535 5.7.8 ...") is recovered from the end of
 * `message` — nodemailer always appends the raw response as ": <response>".
 */
export type FailureVerdict = "permanent" | "transient";

export interface ClassifiableError {
  code?: unknown;
  message?: unknown;
  responseCode?: unknown;
}

/**
 * Errors that cannot succeed without a human changing configuration or the
 * message itself. Everything not listed (and without an SMTP status in the
 * message) falls through to "transient": a bounded retry via the cycle cap is
 * cheaper than wrongly killing a deliverable email.
 */
const PERMANENT_CODES = new Set([
  // Auth / config — the credentials or options are wrong and stay wrong.
  "EAUTH",
  "ENOAUTH",
  "EOAUTH2",
  "ECONFIG",
  // Transport security / endpoint — wrong port, cert or protocol.
  "ETLS",
  "EREQUIRETLS",
  "EPROTOCOL",
  // DNS — hostname does not resolve (typo, expired domain).
  "EDNS",
  "ENOTFOUND",
  // The message itself will never pass.
  "EENVELOPE",
  "EMAXRECIPIENTS",
  "EMESSAGE",
  "EFILEACCESS",
  "EURLACCESS",
  "EPROXY",
]);

/**
 * Errors that describe a network / provider hiccup: retrying later can work.
 * Anything unknown is treated as transient too (see file comment).
 */
const TRANSIENT_CODES = new Set([
  "ECONNECTION",
  "ETIMEDOUT",
  "ESOCKET",
  "EMAXLIMIT",
  "ESTREAM",
  "EFETCH",
  // Temporary DNS failure (Node's dns module) — the resolver, not the hostname.
  "EAI_AGAIN",
]);

/**
 * Pulls the 3-digit SMTP status out of a serialized message.
 * Nodemailer formats responses as ": 535 5.7.8 ..." or ": 451 4.7.1 ...".
 */
function smtpStatusFromMessage(message: string): number | undefined {
  const match = /: ([45]\d{2})[ -]/.exec(message);
  if (!match) return undefined;
  const status = Number(match[1]);
  return Number.isNaN(status) ? undefined : status;
}

function rawMessage(err: ClassifiableError): string {
  return typeof err.message === "string" && err.message.length > 0
    ? err.message
    : String(err);
}

/**
 * Node's DNS resolver embeds the error code inside the message text
 * ("queryA ENOTFOUND badhostname", "getaddrinfo EAI_AGAIN host") — and
 * Inngest's `StepError` wrapper drops the enumerable `code` property, so the
 * failure handler often receives a codeless message only. Tokenizing the
 * message recovers the code in that case.
 */
function codeFromMessage(message: string): string | undefined {
  const tokens = message.match(/\bE[A-Z][A-Z_]*\b/g);
  if (!tokens) return undefined;
  // Permanent wins when a message carries several known codes: misclassifying
  // a config error as transient re-queues it until the cycle cap, while the
  // opposite mistake merely stops early with a readable reason.
  return (
    tokens.find((token) => PERMANENT_CODES.has(token)) ??
    tokens.find((token) => TRANSIENT_CODES.has(token))
  );
}

/** Best available code: explicit `err.code`, else a known code token in the message. */
function resolveCode(err: ClassifiableError): string | undefined {
  if (typeof err.code === "string" && err.code.length > 0) return err.code;
  return codeFromMessage(rawMessage(err));
}

/**
 * Decides the fate of a dead run:
 * - "permanent": abandon now, surface a human-readable reason in D1.
 * - "transient": re-enqueue onto the Cloudflare Queue for a later cycle.
 *
 * Order of evidence: explicit responseCode (in-process only) → SMTP status
 * parsed from the message (survives serialization) → nodemailer error code →
 * known code token embedded in the message (StepError drops `code`) →
 * transient by default, bounded by the queue cycle cap.
 */
export function classifyEmailError(err: ClassifiableError): FailureVerdict {
  if (typeof err.responseCode === "number") {
    return err.responseCode < 500 ? "transient" : "permanent";
  }

  const message = rawMessage(err);
  const status = smtpStatusFromMessage(message);
  if (status !== undefined) {
    return status < 500 ? "transient" : "permanent";
  }

  const code = resolveCode(err);
  if (code) {
    if (PERMANENT_CODES.has(code)) return "permanent";
    if (TRANSIENT_CODES.has(code)) return "transient";
  }

  return "transient";
}

/**
 * User-facing explanation stored in the email history so the dashboard shows
 * why a send stopped instead of a raw nodemailer transcript.
 */
export function friendlyErrorMessage(err: ClassifiableError): string {
  const message = rawMessage(err);
  const code = resolveCode(err);
  const status = smtpStatusFromMessage(message);

  switch (code) {
    case "EAUTH":
    case "ENOAUTH":
      return "Your SMTP provider rejected the credentials — check the SMTP username and password/key in your configuration.";
    case "EOAUTH2":
      return "The OAuth2 token was rejected — re-authorize the SMTP configuration.";
    case "EDNS":
    case "ENOTFOUND":
      return "The SMTP host could not be found — check the host address in your configuration.";
    case "ETLS":
    case "EREQUIRETLS":
      return "TLS negotiation failed — check that the port matches the encryption mode (465 = implicit TLS, 587 = STARTTLS).";
    case "EPROTOCOL":
      return "The server did not speak SMTP — check the host and port in your configuration.";
    case "EENVELOPE":
      return status !== undefined && status < 500
        ? `The SMTP provider temporarily rejected the sender or recipient (status ${status}).`
        : "The SMTP provider rejected the sender or recipient address — check the sender identity and the recipient.";
    case "EMESSAGE":
      return status !== undefined && status < 500
        ? `The SMTP provider temporarily rejected the message content (status ${status}).`
        : "The SMTP provider rejected the message — it exceeds the size limit or violates the provider's content policy.";
    case "ECONFIG":
    case "EFILEACCESS":
    case "EURLACCESS":
    case "EPROXY":
      return "Internal transport configuration error — the message could not be handed to the SMTP provider.";
    default:
      break;
  }

  if (status !== undefined && status >= 500) {
    return `Your SMTP provider permanently rejected this email: ${message}`;
  }

  return `Email delivery failed: ${message}`;
}
