import { MAX_WEBHOOK_URL_LENGTH } from "./webhooks.constants";

/**
 * Rules for the URLs MakiSend will POST webhooks to. Pure: no DNS, no network.
 *
 * Our Worker calls a URL the user chose, so a bad URL is an SSRF: on Cloudflare the network
 * already blocks private addresses, but a self-hosted workerd (Docker, VPS) can reach
 * localhost, the LAN and the cloud metadata service (169.254.169.254). The rules apply on
 * create, on update and before every delivery (a row may predate a stricter rule).
 *
 * Disguised addresses (`127.1`, `0x7f000001`, `2130706433`, `[::ffff:127.0.0.1]`) are handled by
 * letting the WHATWG URL parser normalize the host first, then checking the normalized form.
 *
 * Known limit: a public name whose DNS record points to a private address passes (a Worker
 * cannot resolve names). Self-hosts should restrict outbound traffic or set
 * WEBHOOK_ALLOWED_HOSTS.
 */

export interface WebhookUrlOptions {
  /** Accepts http: and local/private hosts. Local development only. */
  allowInsecureUrls: boolean;
  /** When non-empty, the only hostnames accepted (lowercase, no trailing dot). */
  allowedHosts: readonly string[];
}

export type WebhookUrlResult =
  | { ok: true; url: string; host: string }
  | { ok: false; message: string };

export const WEBHOOK_URL_MESSAGES = {
  tooLong: `Webhook URLs must be at most ${MAX_WEBHOOK_URL_LENGTH} characters.`,
  invalid: "Webhook URL must be a valid absolute URL, like https://example.com/hooks.",
  https: "Webhook URLs must use https.",
  credentials: "Webhook URLs cannot contain a username or password.",
  localhost: "Webhook URLs cannot point to localhost.",
  publicName: "Webhook URLs must use a public domain name.",
  privateNetwork: "This address points to a private network.",
  notAllowed: "This host is not in the list of allowed webhook hosts.",
} as const;

const fail = (message: string): WebhookUrlResult => ({ ok: false, message });

/** Validates a webhook URL and returns its stored form: `new URL().toString()`, without `#fragment`. */
export function parseWebhookUrl(raw: string, options: WebhookUrlOptions): WebhookUrlResult {
  const input = raw.trim();
  if (input.length > MAX_WEBHOOK_URL_LENGTH) return fail(WEBHOOK_URL_MESSAGES.tooLong);

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return fail(WEBHOOK_URL_MESSAGES.invalid);
  }

  const httpAllowed = options.allowInsecureUrls && url.protocol === "http:";
  if (url.protocol !== "https:" && !httpAllowed) {
    return fail(url.protocol === "http:" ? WEBHOOK_URL_MESSAGES.https : WEBHOOK_URL_MESSAGES.invalid);
  }
  if (url.username || url.password) return fail(WEBHOOK_URL_MESSAGES.credentials);

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return fail(WEBHOOK_URL_MESSAGES.invalid);

  if (!options.allowInsecureUrls) {
    const problem = hostProblem(host);
    if (problem) return fail(problem);
  }

  if (options.allowedHosts.length > 0 && !options.allowedHosts.includes(host)) {
    return fail(WEBHOOK_URL_MESSAGES.notAllowed);
  }

  url.hash = "";
  const normalized = url.toString();
  if (normalized.length > MAX_WEBHOOK_URL_LENGTH) return fail(WEBHOOK_URL_MESSAGES.tooLong);
  return { ok: true, url: normalized, host };
}

/** Only the host of a URL, for logs: the path and query can carry a token. */
export function webhookUrlHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid";
  }
}

const LOCAL_SUFFIXES = [".local", ".internal", ".localdomain", ".lan", ".home.arpa"];

function hostProblem(host: string): string | null {
  if (host.startsWith("[")) {
    return isBlockedIPv6(host.slice(1, -1)) ? WEBHOOK_URL_MESSAGES.privateNetwork : null;
  }
  const ipv4 = parseIPv4(host);
  if (ipv4 !== null) return isBlockedIPv4(ipv4) ? WEBHOOK_URL_MESSAGES.privateNetwork : null;

  if (host === "localhost" || host.endsWith(".localhost")) return WEBHOOK_URL_MESSAGES.localhost;
  if (!host.includes(".") || LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return WEBHOOK_URL_MESSAGES.publicName;
  }
  return null;
}

/** A dotted-quad host as a 32-bit number. The URL parser has already turned 127.1 or 0x7f000001 into one. */
function parseIPv4(host: string): number | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => part > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/** Private, reserved, loopback, link-local (cloud metadata), CGNAT, documentation, multicast. */
const BLOCKED_IPV4: readonly [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

const BLOCKED_IPV4_RANGES = BLOCKED_IPV4.map(([base, bits]) => {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return { network: (parseIPv4(base)! & mask) >>> 0, mask };
});

function isBlockedIPv4(address: number): boolean {
  return BLOCKED_IPV4_RANGES.some(({ network, mask }) => ((address & mask) >>> 0) === network);
}

/** The 8 groups of an IPv6 address as the URL parser serializes it (lowercase hex, `::` compression). */
function parseIPv6(address: string): number[] | null {
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => parseInt(group, 16));
}

function isBlockedIPv6(address: string): boolean {
  const g = parseIPv6(address);
  if (!g) return true; // the parser accepted it but we cannot read it: refuse rather than guess
  const zeroUntil = (end: number) => g.slice(0, end).every((group) => group === 0);
  const embeddedIPv4 = (((g[6] << 16) | g[7]) >>> 0);

  if (zeroUntil(8)) return true; // :: unspecified
  if (zeroUntil(7) && g[7] === 1) return true; // ::1 loopback
  if (zeroUntil(5) && g[5] === 0xffff) return isBlockedIPv4(embeddedIPv4); // ::ffff:a.b.c.d mapped
  if (zeroUntil(6)) return true; // ::a.b.c.d, deprecated IPv4-compatible
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isBlockedIPv4(embeddedIPv4); // 64:ff9b::/96 NAT64
  }
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // 2001:db8::/32 documentation
  if (g[0] === 0x0100 && g.slice(1, 4).every((x) => x === 0)) return true; // 100::/64 discard
  return false;
}
