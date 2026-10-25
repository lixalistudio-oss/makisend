/**
 * Classifies a failed send attempt. The verdict decides whether the workflow
 * gives up permanently (dead per the user) or retries the SMTP step.
 *
 * `responseCode` is read when the error carries it, but nodemailer does not
 * always attach it — so the SMTP status a server actually replied with
 * (e.g. "535 5.7.8 ...") is also recovered from the end of `message`;
 * nodemailer appends the raw response as ": <response>".
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
 * message) falls through to "transient": a bounded retry is cheaper than
 * wrongly killing a deliverable email.
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
 * ("queryA ENOTFOUND badhostname", "getaddrinfo EAI_AGAIN host") — and some
 * error wrappers drop the enumerable `code` property, so a codeless message
 * is common. Tokenizing the message recovers the code in that case.
 */
function codeFromMessage(message: string): string | undefined {
  const tokens = message.match(/\bE[A-Z][A-Z_]*\b/g);
  if (!tokens) return undefined;
  // Permanent wins when a message carries several known codes: misclassifying
  // a config error as transient retries it until the retry budget is spent,
  // while the opposite mistake merely stops early with a readable reason.
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
 * - "transient": retry the SMTP step after the configured backoff.
 *
 * Order of evidence: explicit responseCode (in-process only) → SMTP status
 * parsed from the message (survives serialization) → nodemailer error code →
 * known code token embedded in the message (StepError drops `code`) →
 * transient by default, bounded by the workflow retry budget.
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
    case "ECONNECTION":
    case "ESOCKET":
      // Cloudflare Workers block outbound port 25, so a 25 config lands here
      // with the platform's own "port 25 is blocked" text — call it out.
      return /port 25 is blocked/i.test(message)
        ? "Outbound port 25 is blocked on Cloudflare Workers — use port 465 (TLS) or 587 (STARTTLS) instead."
        : "Could not connect to the SMTP server — check that the host and port are correct, that the port matches the encryption mode (465 = TLS, 587 = STARTTLS), and that the provider allows connections from Cloudflare Workers.";
    case "ETIMEDOUT":
      return "The SMTP server did not respond in time — check the host and port, and whether a firewall allows outbound connections on that port.";
    case "ESTREAM":
      return "The email content could not be streamed to the SMTP provider — try sending the email again.";
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
    // The raw provider response is intentionally not forwarded to the user:
    // it can contain internal hostnames and server details.
    return `Your SMTP provider permanently rejected this email (status ${status}).`;
  }

  return "Email delivery failed unexpectedly — please try again, and contact support if the problem persists.";
}

/** A send error as nodemailer raises it: `command` names the SMTP step that failed. */
export interface RecipientRejectionEvidence extends ClassifiableError {
  command?: unknown;
}

/**
 * Enhanced status codes (RFC 3463) that mean "this address does not work", not "this message
 * or this sender was refused": bad mailbox (5.1.1), bad domain (5.1.2), bad address syntax
 * (5.1.3), mailbox moved (5.1.6), null MX (5.1.10), mailbox disabled (5.2.1).
 */
const DEAD_ADDRESS_STATUSES = new Set(["5.1.1", "5.1.2", "5.1.3", "5.1.6", "5.1.10", "5.2.1"]);

/** A permanent enhanced status, delimited on both sides so an IP in the reply (192.5.1.10) is not read as one. */
const ENHANCED_STATUS = /(?:^|[\s:(])(5\.\d{1,3}\.\d{1,3})(?=[\s;,)]|$)/;

/** Servers without enhanced codes: the reply text has to say the mailbox does not exist. */
const DEAD_ADDRESS_TEXT =
  /no such (user|mailbox|recipient)|(user|mailbox|recipient|address)\b[^.;]{0,40}\b(unknown|not found|does ?n[o']t exist|invalid|disabled|unavailable)/i;

/**
 * True only when the SMTP server refused the recipient address itself during RCPT TO with a
 * permanent status: the address is dead, and sending to it again would hurt the sender's
 * reputation. Refusals of the sender, the content, a policy (5.7.x), a full mailbox (5.2.2) or
 * any temporary status never qualify: suppressing a working address is the worse mistake.
 *
 * Asynchronous bounces (accepted at RCPT, bounced later by email) are not visible here.
 */
export function isRecipientHardBounce(err: RecipientRejectionEvidence): boolean {
  const message = rawMessage(err);
  const atRcpt =
    err.command === "RCPT TO" ||
    (err.command === undefined && /recipients? (were )?rejected|recipient command failed/i.test(message));
  if (!atRcpt) return false;

  const status = typeof err.responseCode === "number" ? err.responseCode : smtpStatusFromMessage(message);
  if (status === undefined || status < 500) return false;

  const enhanced = ENHANCED_STATUS.exec(message)?.[1];
  if (enhanced) return DEAD_ADDRESS_STATUSES.has(enhanced);
  return [550, 551, 553].includes(status) && DEAD_ADDRESS_TEXT.test(message);
}

/**
 * Reason stored on a bounce suppression: the status codes only. The server's free text can
 * carry the address or internal hostnames, and the reason is stored in clear.
 */
export function recipientRejectionReason(err: RecipientRejectionEvidence): string {
  const message = rawMessage(err);
  const status = typeof err.responseCode === "number" ? err.responseCode : smtpStatusFromMessage(message);
  const enhanced = ENHANCED_STATUS.exec(message)?.[1];
  const codes = [status, enhanced].filter((part) => part !== undefined).join(" ");
  return `The recipient's server rejected the address${codes ? ` (${codes})` : ""}.`;
}
