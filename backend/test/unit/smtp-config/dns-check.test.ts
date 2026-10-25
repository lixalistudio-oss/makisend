import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { encrypt } from "@/core/crypto";
import { errorHandler } from "@/middleware/error.handler";
import { createSmtpConfigController } from "@/smtp-config/smtp-config.controller";
import { SmtpConfigService } from "@/smtp-config/smtp-config.service";
import {
  COMMON_DKIM_SELECTORS,
  DohDnsResolver,
  checkDkim,
  evaluateDmarc,
  evaluateSpf,
  joinTxtData,
  runDnsCheck,
  senderDomain,
  type DnsCheckResult,
  type IDnsResolver,
} from "@/smtp-config/dns-check";
import type {
  ISmtpConfigRepository,
  SmtpConfigInput,
  SmtpConfigRecord,
  SmtpConfigUpdateInput,
} from "@/smtp-config/smtp-config.types";

const AES_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const OWNER = "user-1";

/** Answers from a fixed zone; a name listed in `failing` makes the lookup throw. */
class FakeResolver implements IDnsResolver {
  readonly queried: string[] = [];
  constructor(
    private readonly zone: Record<string, string[]>,
    private readonly mx: Record<string, number> = {},
    private readonly failing: ReadonlySet<string> = new Set(),
  ) {}

  async txt(name: string): Promise<string[]> {
    this.queried.push(name);
    if (this.failing.has(name)) throw new Error("SERVFAIL");
    return this.zone[name] ?? [];
  }

  async mxCount(name: string): Promise<number> {
    if (this.failing.has(`MX:${name}`)) throw new Error("SERVFAIL");
    return this.mx[name] ?? 0;
  }
}

describe("DNS check rules", () => {
  it("reads the sender domain, lower-cased", () => {
    expect(senderDomain("Sender@Mail.Example.COM")).toBe("mail.example.com");
  });

  it("joins a TXT answer split into several quoted strings", () => {
    expect(joinTxtData('"v=spf1 include:_spf.google.com " "~all"')).toBe("v=spf1 include:_spf.google.com ~all");
    expect(joinTxtData('"a \\"quoted\\" value"')).toBe('a "quoted" value');
  });

  it.each([
    [[], "fail", "spf_missing"],
    [["v=spf1 -all", "v=spf1 include:x ~all"], "fail", "spf_multiple"],
    [["v=spf1 include:x +all"], "fail", "spf_allows_all"],
    [["v=spf1 include:x all"], "fail", "spf_allows_all"],
    [["v=spf1 include:x ?all"], "warn", "spf_weak"],
    [["v=spf1 include:x"], "warn", "spf_weak"],
    [["v=spf1 redirect=_spf.example.net"], "pass", "spf_ok"],
    [["google-site-verification=abc", "v=spf1 include:_spf.google.com ~all"], "pass", "spf_ok"],
    [["v=spf1 ip4:192.0.2.1 -all"], "pass", "spf_ok"],
  ])("SPF %j is %s (%s)", (records, status, code) => {
    expect(evaluateSpf(records)).toMatchObject({ status, code });
  });

  it.each([
    [undefined, "fail", "dmarc_missing", undefined],
    ["v=DMARC1; p=none; rua=mailto:r@example.com", "warn", "dmarc_monitoring", "none"],
    ["v=DMARC1; p=quarantine", "pass", "dmarc_ok", "quarantine"],
    ["v=DMARC1;p=REJECT;pct=100", "pass", "dmarc_ok", "reject"],
    ["v=DMARC1; rua=mailto:r@example.com", "fail", "dmarc_invalid", undefined],
  ])("DMARC %j is %s (%s)", (record, status, code, policy) => {
    const result = evaluateDmarc(record);
    expect(result).toMatchObject({ status, code });
    expect(result.policy).toBe(policy);
  });
});

describe("DKIM", () => {
  it("finds a key under one of the usual selectors", async () => {
    const resolver = new FakeResolver({ "s1._domainkey.example.com": ["v=DKIM1; k=rsa; p=MIGfMA0GCSq"] });
    const result = await checkDkim(resolver, "example.com");
    expect(result).toMatchObject({ status: "pass", code: "dkim_ok", selector: "s1" });
    expect(resolver.queried).toHaveLength(COMMON_DKIM_SELECTORS.length);
  });

  it("only queries the selector it is given", async () => {
    const resolver = new FakeResolver({ "pm._domainkey.example.com": ["k=rsa; p=MIGfMA0"] });
    expect(await checkDkim(resolver, "example.com", "pm")).toMatchObject({ status: "pass", selector: "pm" });
    expect(resolver.queried).toEqual(["pm._domainkey.example.com"]);
  });

  it("says a missing key under an explicit selector is a failure", async () => {
    expect(await checkDkim(new FakeResolver({}), "example.com", "pm")).toMatchObject({
      status: "fail",
      code: "dkim_missing",
    });
  });

  it("does not call a missing common selector a failure: the selector is provider-specific", async () => {
    expect(await checkDkim(new FakeResolver({}), "example.com")).toMatchObject({
      status: "unknown",
      code: "dkim_selector_unknown",
    });
  });

  it("flags a revoked (empty) key", async () => {
    const resolver = new FakeResolver({ "google._domainkey.example.com": ["v=DKIM1; p="] });
    expect(await checkDkim(resolver, "example.com")).toMatchObject({ status: "fail", code: "dkim_revoked" });
  });

  it("reports an unknown result when every lookup failed", async () => {
    const resolver = new FakeResolver({}, {}, new Set(["pm._domainkey.example.com"]));
    expect(await checkDkim(resolver, "example.com", "pm")).toMatchObject({ status: "unknown", code: "lookup_failed" });
  });
});

describe("runDnsCheck", () => {
  const now = () => new Date("2026-10-25T12:00:00.000Z");

  it("checks every record of a well-configured domain", async () => {
    const resolver = new FakeResolver(
      {
        "example.com": ["v=spf1 include:amazonses.com -all"],
        "_dmarc.example.com": ["v=DMARC1; p=reject"],
        "resend._domainkey.example.com": ["p=MIGfMA0GCSqGSIb3DQEB"],
      },
      { "example.com": 2 },
    );
    const result = await runDnsCheck(resolver, "hello@example.com", { now });
    expect(result).toMatchObject({
      domain: "example.com",
      spf: { status: "pass" },
      dkim: { status: "pass", selector: "resend" },
      dmarc: { status: "pass", policy: "reject", recordDomain: "example.com" },
      mx: { status: "pass" },
      checkedAt: "2026-10-25T12:00:00.000Z",
    });
  });

  it("falls back to the organizational domain's DMARC record for a subdomain sender", async () => {
    const resolver = new FakeResolver({ "_dmarc.example.com": ["v=DMARC1; p=quarantine"] });
    const result = await runDnsCheck(resolver, "noreply@mail.example.com", { now });
    expect(result.dmarc).toMatchObject({ status: "pass", recordDomain: "example.com" });
    expect(result.mx).toMatchObject({ status: "warn", code: "mx_missing" });
  });

  it("keeps the other checks when one lookup fails", async () => {
    const resolver = new FakeResolver(
      { "_dmarc.example.com": ["v=DMARC1; p=none"] },
      {},
      new Set(["example.com", "MX:example.com"]),
    );
    const result = await runDnsCheck(resolver, "a@example.com", { now });
    expect(result.spf).toMatchObject({ status: "unknown", code: "lookup_failed" });
    expect(result.mx).toMatchObject({ status: "unknown", code: "lookup_failed" });
    expect(result.dmarc).toMatchObject({ status: "warn", code: "dmarc_monitoring" });
  });
});

describe("DohDnsResolver", () => {
  const answer = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/dns-json" } });

  it("queries the JSON API and keeps only TXT answers", async () => {
    const urls: string[] = [];
    const resolver = new DohDnsResolver(async (url, init) => {
      urls.push(url);
      expect(new Headers(init?.headers).get("Accept")).toBe("application/dns-json");
      return answer({
        Status: 0,
        Answer: [
          { type: 5, data: "target.example.net." },
          { type: 16, data: '"v=DKIM1; p=abc" "def"' },
        ],
      });
    });
    expect(await resolver.txt("s1._domainkey.example.com")).toEqual(["v=DKIM1; p=abcdef"]);
    expect(urls[0]).toBe("https://one.one.one.one/dns-query?name=s1._domainkey.example.com&type=16");
  });

  it("treats NXDOMAIN as no record and SERVFAIL or HTTP errors as a failed lookup", async () => {
    expect(await new DohDnsResolver(async () => answer({ Status: 3 })).txt("nope.example.com")).toEqual([]);
    await expect(new DohDnsResolver(async () => answer({ Status: 2 })).txt("x.example.com")).rejects.toThrow("RCODE 2");
    await expect(new DohDnsResolver(async () => answer({}, 503)).mxCount("x.example.com")).rejects.toThrow("HTTP 503");
  });

  it("counts MX answers", async () => {
    const resolver = new DohDnsResolver(async () =>
      answer({ Status: 0, Answer: [{ type: 15, data: "10 mx1.example.com." }, { type: 15, data: "20 mx2.example.com." }] }),
    );
    expect(await resolver.mxCount("example.com")).toBe(2);
  });
});

class InMemorySmtpConfigRepository implements ISmtpConfigRepository {
  readonly records = new Map<string, SmtpConfigRecord>();

  async create(userId: string, input: SmtpConfigInput): Promise<SmtpConfigRecord> {
    const record: SmtpConfigRecord = {
      id: `cfg-${this.records.size + 1}`,
      userId,
      ...input,
      isActive: true,
      lastCheckAt: null,
      lastCheckOk: null,
      lastCheckError: null,
      bounceWebhookProvider: null,
      bounceWebhookSecret: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.records.set(record.id, record);
    return record;
  }
  async findByUserId(userId: string) {
    return [...this.records.values()].filter((r) => r.userId === userId);
  }
  async findAll() {
    return [...this.records.values()];
  }
  async findById(id: string) {
    return this.records.get(id) ?? null;
  }
  async update(id: string, input: SmtpConfigUpdateInput): Promise<SmtpConfigRecord> {
    const next: SmtpConfigRecord = { ...this.records.get(id)!, ...input };
    this.records.set(id, next);
    return next;
  }
  async delete(id: string) {
    this.records.delete(id);
  }
}

describe("GET /smtp-config/:id/dns-check", () => {
  async function buildApp(userId = OWNER) {
    const repo = new InMemorySmtpConfigRepository();
    const record = await repo.create(OWNER, {
      smtpHostname: await encrypt("smtp.example.com", AES_KEY),
      smtpPort: 587,
      smtpSecurity: "starttls",
      smtpUsername: await encrypt("user", AES_KEY),
      smtpPassword: await encrypt("secret", AES_KEY),
      senderEmail: await encrypt("hello@example.com", AES_KEY),
    });
    const resolver = new FakeResolver(
      { "example.com": ["v=spf1 -all"], "pm._domainkey.example.com": ["p=abc"] },
      { "example.com": 1 },
    );
    const service = new SmtpConfigService(repo, AES_KEY, { dnsResolver: resolver });

    const app = new Hono<{ Variables: { userId: string } }>();
    app.use("*", async (c, next) => {
      c.set("userId", userId);
      await next();
    });
    app.onError(errorHandler);
    app.route("/smtp-config", createSmtpConfigController(() => service));
    return { app, id: record.id, resolver };
  }

  it("checks the configuration's decrypted sender domain with the given selector", async () => {
    const { app, id, resolver } = await buildApp();
    const res = await app.request(`/smtp-config/${id}/dns-check?dkimSelector=pm`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DnsCheckResult;
    expect(body).toMatchObject({
      domain: "example.com",
      spf: { status: "pass" },
      dkim: { status: "pass", selector: "pm" },
      dmarc: { status: "fail", code: "dmarc_missing" },
      mx: { status: "pass" },
    });
    expect(resolver.queried).toContain("pm._domainkey.example.com");
  });

  it("refuses a selector that is not a DNS label", async () => {
    const { app, id } = await buildApp();
    const res = await app.request(`/smtp-config/${id}/dns-check?dkimSelector=${encodeURIComponent("a b/../")}`);
    expect(res.status).toBe(400);
  });

  it("refuses another user's configuration", async () => {
    const { app, id } = await buildApp("someone-else");
    const res = await app.request(`/smtp-config/${id}/dns-check`);
    expect(res.status).toBe(403);
  });
});
