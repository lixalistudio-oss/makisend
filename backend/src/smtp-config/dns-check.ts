/**
 * Sender-domain DNS diagnostic: SPF, DKIM, DMARC and MX of the domain in a configuration's
 * sender address. MakiSend does not sign or authenticate mail itself (the SMTP provider
 * does), so this only reads public DNS and says what receivers will find there.
 *
 * Workers have no DNS socket API: records are read over DNS-over-HTTPS (JSON API).
 */

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Cloudflare's resolver under its one.one.one.one name: some networks cut TLS to
 * cloudflare-dns.com / 1.1.1.1 (seen from Benin), which would break the check under `wrangler dev`.
 */
export const DOH_ENDPOINT = "https://one.one.one.one/dns-query";

/** Selectors tried when the caller does not give one: the usual providers' defaults. */
export const COMMON_DKIM_SELECTORS = [
  "default",
  "google",
  "selector1",
  "selector2",
  "s1",
  "s2",
  "k1",
  "k2",
  "resend",
  "mail",
  "dkim",
  "smtp",
  "mandrill",
  "zoho",
  "sig1",
  "protonmail",
  "cf2024-1",
  "mxvault",
] as const;

/** A DKIM selector is one or more DNS labels. */
export const DKIM_SELECTOR_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

export type DnsCheckStatus = "pass" | "warn" | "fail" | "unknown";

export interface DnsCheckItem {
  status: DnsCheckStatus;
  /** Stable identifier of the outcome, for the dashboard's translations. */
  code: string;
  /** English explanation, safe to show as is. */
  message: string;
  /** The record that was evaluated, when there is one. */
  record?: string;
}

export interface DnsCheckResult {
  domain: string;
  spf: DnsCheckItem;
  dkim: DnsCheckItem & { selector?: string };
  dmarc: DnsCheckItem & { policy?: string; recordDomain?: string };
  mx: DnsCheckItem;
  checkedAt: string;
}

export interface IDnsResolver {
  /** TXT strings of `name` ([] when the name has none or does not exist). Throws on a lookup failure. */
  txt(name: string): Promise<string[]>;
  /** Number of MX records of `name`. Throws on a lookup failure. */
  mxCount(name: string): Promise<number>;
}

interface DohAnswer {
  type?: unknown;
  data?: unknown;
}

interface DohResponse {
  Status?: unknown;
  Answer?: unknown;
}

const TXT = 16;
const MX = 15;
/** NOERROR and NXDOMAIN are answers; every other RCODE (SERVFAIL...) is a failed lookup. */
const NOERROR = 0;
const NXDOMAIN = 3;

/** A TXT answer is one or more quoted strings ("v=spf1 ..." "include:..."), joined as one record. */
export function joinTxtData(data: string): string {
  const chunks = data.match(/"((?:[^"\\]|\\.)*)"/g);
  if (!chunks) return data;
  return chunks.map((chunk) => chunk.slice(1, -1).replace(/\\(.)/g, "$1")).join("");
}

export class DohDnsResolver implements IDnsResolver {
  constructor(
    private readonly fetcher: Fetcher = (input, init) => fetch(input, init),
    private readonly endpoint: string = DOH_ENDPOINT,
  ) {}

  private async query(name: string, type: number): Promise<DohAnswer[]> {
    const url = `${this.endpoint}?name=${encodeURIComponent(name)}&type=${type}`;
    const res = await this.fetcher(url, { headers: { Accept: "application/dns-json" } });
    if (!res.ok) throw new Error(`DNS-over-HTTPS answered HTTP ${res.status}`);
    const body = (await res.json()) as DohResponse;
    if (body.Status === NXDOMAIN) return [];
    if (body.Status !== NOERROR) throw new Error(`DNS lookup failed (RCODE ${String(body.Status)})`);
    return Array.isArray(body.Answer) ? (body.Answer as DohAnswer[]) : [];
  }

  async txt(name: string): Promise<string[]> {
    // CNAMEs are followed by the resolver: keep only the TXT answers of the chain.
    return (await this.query(name, TXT))
      .filter((answer) => answer.type === TXT && typeof answer.data === "string")
      .map((answer) => joinTxtData(answer.data as string));
  }

  async mxCount(name: string): Promise<number> {
    return (await this.query(name, MX)).filter((answer) => answer.type === MX).length;
  }
}

/** Domain part of an address, lower-cased, without a trailing dot. */
export function senderDomain(address: string): string {
  const at = address.lastIndexOf("@");
  return address.slice(at + 1).trim().replace(/\.$/, "").toLowerCase();
}

const UNKNOWN_LOOKUP = (what: string): DnsCheckItem => ({
  status: "unknown",
  code: "lookup_failed",
  message: `The ${what} lookup failed. Try again in a moment.`,
});

export function evaluateSpf(records: string[]): DnsCheckItem {
  const spf = records.filter((record) => /^v=spf1(\s|$)/i.test(record.trim()));
  if (spf.length === 0) {
    return {
      status: "fail",
      code: "spf_missing",
      message: "No SPF record. Add the TXT record your SMTP provider gives you (it starts with v=spf1).",
    };
  }
  if (spf.length > 1) {
    return {
      status: "fail",
      code: "spf_multiple",
      message: "Several SPF records: receivers treat that as an error. Merge them into a single v=spf1 record.",
      record: spf.join(" | "),
    };
  }
  const record = spf[0]!.trim();
  if (/(^|\s)\+?all(\s|$)/i.test(record)) {
    return {
      status: "fail",
      code: "spf_allows_all",
      message: "The SPF record ends with +all, which lets any server send as this domain. Use ~all or -all.",
      record,
    };
  }
  if (!/(^|\s)[~-]all(\s|$)/i.test(record) && !/(^|\s)redirect=/i.test(record)) {
    return {
      status: "warn",
      code: "spf_weak",
      message: "The SPF record does not end with ~all or -all, so it does not say which servers are refused.",
      record,
    };
  }
  return { status: "pass", code: "spf_ok", message: "SPF record found.", record };
}

/** A DKIM key record: `p=` with a non-empty key (an empty `p=` is a revoked key). */
function dkimKey(records: string[]): string | undefined {
  return records.find((record) => /(^|;)\s*p=[A-Za-z0-9+/=]+/i.test(record) || /v=DKIM1/i.test(record));
}

export async function checkDkim(
  resolver: IDnsResolver,
  domain: string,
  selector?: string,
): Promise<DnsCheckItem & { selector?: string }> {
  const selectors = selector ? [selector] : [...COMMON_DKIM_SELECTORS];
  const results = await Promise.allSettled(
    selectors.map((candidate) => resolver.txt(`${candidate}._domainkey.${domain}`)),
  );

  for (const [i, result] of results.entries()) {
    if (result.status !== "fulfilled") continue;
    const record = dkimKey(result.value);
    if (!record) continue;
    if (/(^|;)\s*p=\s*(;|$)/i.test(record)) {
      return {
        status: "fail",
        code: "dkim_revoked",
        message: `The DKIM key for selector "${selectors[i]}" is empty (revoked).`,
        selector: selectors[i],
        record,
      };
    }
    return {
      status: "pass",
      code: "dkim_ok",
      message: `DKIM key found for selector "${selectors[i]}".`,
      selector: selectors[i],
      record,
    };
  }

  if (results.every((result) => result.status === "rejected")) return UNKNOWN_LOOKUP("DKIM");

  if (selector) {
    return {
      status: "fail",
      code: "dkim_missing",
      message: `No DKIM key for selector "${selector}". Publish the record your SMTP provider gives you.`,
      selector,
    };
  }
  // Selectors are provider-specific: not finding a common one proves nothing.
  return {
    status: "unknown",
    code: "dkim_selector_unknown",
    message:
      "No DKIM key under the usual selectors. Give the selector your provider uses (the s= value of the DKIM-Signature header) to check it.",
  };
}

/** The domain and its parents down to two labels: where a DMARC record may apply from. */
function dmarcCandidates(domain: string): string[] {
  const labels = domain.split(".");
  const candidates: string[] = [];
  for (let i = 0; i <= labels.length - 2; i++) candidates.push(labels.slice(i).join("."));
  return candidates;
}

export function evaluateDmarc(record: string | undefined, recordDomain?: string): DnsCheckItem & { policy?: string; recordDomain?: string } {
  if (!record) {
    return {
      status: "fail",
      code: "dmarc_missing",
      message:
        "No DMARC record. Gmail and Yahoo require one for bulk senders: start with a TXT record at _dmarc.<domain> such as v=DMARC1; p=none; rua=mailto:<you>.",
    };
  }
  const policy = /(^|;)\s*p=\s*([a-z]+)/i.exec(record)?.[2]?.toLowerCase();
  if (policy === "quarantine" || policy === "reject") {
    return { status: "pass", code: "dmarc_ok", message: `DMARC policy is ${policy}.`, record, policy, recordDomain };
  }
  if (policy === "none") {
    return {
      status: "warn",
      code: "dmarc_monitoring",
      message: "DMARC policy is none: receivers only report. Move to quarantine once your reports are clean.",
      record,
      policy,
      recordDomain,
    };
  }
  return {
    status: "fail",
    code: "dmarc_invalid",
    message: "The DMARC record has no valid p= policy (none, quarantine or reject).",
    record,
    recordDomain,
  };
}

async function checkDmarc(resolver: IDnsResolver, domain: string) {
  try {
    // The closest record wins: a subdomain's own record, else its parent's (organizational domain).
    for (const candidate of dmarcCandidates(domain)) {
      const record = (await resolver.txt(`_dmarc.${candidate}`)).find((txt) => /^v=DMARC1(\s|;|$)/i.test(txt.trim()));
      if (record) return evaluateDmarc(record.trim(), candidate);
    }
    return evaluateDmarc(undefined);
  } catch {
    return UNKNOWN_LOOKUP("DMARC");
  }
}

async function checkMx(resolver: IDnsResolver, domain: string): Promise<DnsCheckItem> {
  try {
    const count = await resolver.mxCount(domain);
    return count > 0
      ? { status: "pass", code: "mx_ok", message: "The domain receives mail (MX record found)." }
      : {
          status: "warn",
          code: "mx_missing",
          message: "The domain has no MX record: some receivers distrust senders whose domain cannot receive replies or bounces.",
        };
  } catch {
    return UNKNOWN_LOOKUP("MX");
  }
}

export async function runDnsCheck(
  resolver: IDnsResolver,
  senderEmail: string,
  options: { dkimSelector?: string; now?: () => Date } = {},
): Promise<DnsCheckResult> {
  const domain = senderDomain(senderEmail);
  const [spf, dkim, dmarc, mx] = await Promise.all([
    resolver.txt(domain).then(evaluateSpf, () => UNKNOWN_LOOKUP("SPF")),
    checkDkim(resolver, domain, options.dkimSelector),
    checkDmarc(resolver, domain),
    checkMx(resolver, domain),
  ]);
  return { domain, spf, dkim, dmarc, mx, checkedAt: (options.now ?? (() => new Date()))().toISOString() };
}
