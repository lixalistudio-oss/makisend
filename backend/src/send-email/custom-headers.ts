import { z } from "zod";

/**
 * Custom headers on POST /send-email (`headers`). The accepted set is Cloudflare Email
 * Service's allowlist, applied to every transport: one payload behaves the same whether a
 * configuration sends over SMTP or through the `send_email` binding, and a header the
 * binding would refuse at send time is refused here with a 400 instead.
 * https://developers.cloudflare.com/email-service/reference/headers/
 *
 * Headers that have their own field (From, To, Subject, Reply-To) or that the transport
 * writes (Date, Message-ID, MIME-Version, Content-*, DKIM-Signature...) are not settable.
 */
export const ALLOWED_HEADERS = [
  "In-Reply-To",
  "References",
  "Thread-Index",
  "Thread-Topic",
  "List-Unsubscribe",
  "List-Unsubscribe-Post",
  "List-Id",
  "List-Archive",
  "List-Help",
  "List-Owner",
  "List-Post",
  "List-Subscribe",
  "Precedence",
] as const;

export const MAX_CUSTOM_HEADERS = 50;
export const MAX_HEADER_NAME_LENGTH = 100;
export const MAX_HEADER_VALUE_BYTES = 2048;
export const MAX_HEADERS_TOTAL_BYTES = 16 * 1024;

const X_HEADER = /^X-[A-Za-z0-9_-]+$/i;
const CANONICAL = new Map<string, string>(ALLOWED_HEADERS.map((name) => [name.toLowerCase(), name]));
/** Field names that have a dedicated payload field. */
const API_FIELDS = new Set(["from", "to", "cc", "bcc", "subject", "reply-to"]);
const PRECEDENCE_VALUES = new Set(["bulk", "list", "junk"]);
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000a-\u001f\u007f]/;

const byteLength = (value: string) => new TextEncoder().encode(value).length;

/** The documented spelling of an accepted name (`x-campaign` -> `X-campaign`), or null when refused. */
export function canonicalHeaderName(name: string): string | null {
  const allowed = CANONICAL.get(name.toLowerCase());
  if (allowed) return allowed;
  if (name.length <= MAX_HEADER_NAME_LENGTH && X_HEADER.test(name)) return `X-${name.slice(2)}`;
  return null;
}

/** `<https://...>` / `<mailto:...>` URIs, comma-separated (RFC 2369). Plain http is refused. */
function unsubscribeUris(value: string): string[] | null {
  const uris = value.split(",").map((part) => part.trim());
  if (uris.length === 0 || uris.some((uri) => !/^<(https:\/\/|mailto:)[^<>\s]+>$/i.test(uri))) return null;
  return uris;
}

export const CustomHeadersDto = z
  .record(z.string(), z.string())
  .superRefine((headers, ctx) => {
    const entries = Object.entries(headers);
    if (entries.length > MAX_CUSTOM_HEADERS) {
      ctx.addIssue({ code: "custom", message: `At most ${MAX_CUSTOM_HEADERS} custom headers.` });
      return;
    }

    const seen = new Set<string>();
    let total = 0;
    for (const [name, value] of entries) {
      const lower = name.toLowerCase();
      if (API_FIELDS.has(lower)) {
        ctx.addIssue({
          code: "custom",
          path: [name],
          message: `${name} cannot be set as a header: use the ${lower === "reply-to" ? "reply_to" : lower} field.`,
        });
        continue;
      }
      const canonical = canonicalHeaderName(name);
      if (!canonical) {
        ctx.addIssue({
          code: "custom",
          path: [name],
          message: `Header ${name} is not allowed. Use an X- header or one of: ${ALLOWED_HEADERS.join(", ")}.`,
        });
        continue;
      }
      if (seen.has(lower)) {
        ctx.addIssue({ code: "custom", path: [name], message: `Header ${name} is set twice.` });
        continue;
      }
      seen.add(lower);

      // A line break in a value would start a new header (header injection).
      if (CONTROL_CHARS.test(value)) {
        ctx.addIssue({ code: "custom", path: [name], message: `Header ${name} must not contain line breaks or control characters.` });
        continue;
      }
      if (value.trim().length === 0) {
        ctx.addIssue({ code: "custom", path: [name], message: `Header ${name} cannot be empty.` });
        continue;
      }
      const size = byteLength(value);
      if (size > MAX_HEADER_VALUE_BYTES) {
        ctx.addIssue({ code: "custom", path: [name], message: `Header ${name} must be at most ${MAX_HEADER_VALUE_BYTES} bytes.` });
        continue;
      }
      total += byteLength(canonical) + size;

      if (canonical === "List-Unsubscribe" && !unsubscribeUris(value)) {
        ctx.addIssue({
          code: "custom",
          path: [name],
          message: "List-Unsubscribe must hold <https://...> and/or <mailto:...> URIs, comma-separated.",
        });
      }
      if (canonical === "Precedence" && !PRECEDENCE_VALUES.has(value.trim())) {
        ctx.addIssue({ code: "custom", path: [name], message: "Precedence must be bulk, list or junk." });
      }
    }

    if (total > MAX_HEADERS_TOTAL_BYTES) {
      ctx.addIssue({ code: "custom", message: `Custom headers must total at most ${MAX_HEADERS_TOTAL_BYTES} bytes.` });
    }

    // RFC 8058 one-click: exact value, and an HTTPS unsubscribe URI to POST to.
    const post = entries.find(([name]) => name.toLowerCase() === "list-unsubscribe-post");
    if (post) {
      const list = entries.find(([name]) => name.toLowerCase() === "list-unsubscribe");
      if (post[1] !== "List-Unsubscribe=One-Click") {
        ctx.addIssue({ code: "custom", path: [post[0]], message: "List-Unsubscribe-Post must be exactly List-Unsubscribe=One-Click." });
      } else if (!list || !unsubscribeUris(list[1])?.some((uri) => /^<https:\/\//i.test(uri))) {
        ctx.addIssue({
          code: "custom",
          path: [post[0]],
          message: "List-Unsubscribe-Post needs a List-Unsubscribe header with an <https://...> URI.",
        });
      }
    }
  })
  .describe(
    "Custom headers: any X- header, plus In-Reply-To, References, Thread-Index, Thread-Topic, List-Unsubscribe (<https://...> and/or <mailto:...>), List-Unsubscribe-Post (exactly List-Unsubscribe=One-Click), List-Id, List-Archive, List-Help, List-Owner, List-Post, List-Subscribe and Precedence (bulk, list, junk). Values: no line breaks, at most 2048 bytes; at most 50 headers.",
  )
  // Stored and sent under their documented spelling.
  .transform((headers) =>
    Object.fromEntries(Object.entries(headers).map(([name, value]) => [canonicalHeaderName(name) ?? name, value.trim()])),
  );

export type CustomHeaders = z.infer<typeof CustomHeadersDto>;
