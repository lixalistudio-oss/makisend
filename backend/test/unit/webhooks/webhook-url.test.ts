import { describe, it, expect } from "vitest";
import { parseWebhookUrl, webhookUrlHost, WEBHOOK_URL_MESSAGES } from "@/webhooks/webhook-url";

const STRICT = { allowInsecureUrls: false, allowedHosts: [] };
const INSECURE = { allowInsecureUrls: true, allowedHosts: [] };

describe("parseWebhookUrl: accepted", () => {
  it.each([
    ["https://app.example.com/hooks/makisend", "https://app.example.com/hooks/makisend"],
    ["https://app.example.com", "https://app.example.com/"],
    ["https://hooks.slack.com/services/T0/B0/xyz?token=abc", "https://hooks.slack.com/services/T0/B0/xyz?token=abc"],
    ["https://app.example.com:8443/hook", "https://app.example.com:8443/hook"],
    ["https://8.8.8.8/hook", "https://8.8.8.8/hook"],
    ["https://[2606:4700:4700::1111]/hook", "https://[2606:4700:4700::1111]/hook"],
    ["https://[::ffff:8.8.8.8]/hook", "https://[::ffff:808:808]/hook"],
  ])("%s", (input, expected) => {
    expect(parseWebhookUrl(input, STRICT)).toEqual({ ok: true, url: expected, host: expect.any(String) });
  });

  it("normalizes: lowercase host, no fragment, surrounding spaces trimmed", () => {
    const result = parseWebhookUrl("  HTTPS://App.Example.COM/Hooks/X#section  ", STRICT);
    expect(result).toEqual({ ok: true, url: "https://app.example.com/Hooks/X", host: "app.example.com" });
  });

  it("two spellings of one URL give the same stored value", () => {
    const a = parseWebhookUrl("https://APP.example.com/hook#a", STRICT);
    const b = parseWebhookUrl("https://app.example.com/hook", STRICT);
    expect(a.ok && b.ok && a.url === b.url).toBe(true);
  });
});

describe("parseWebhookUrl: refused", () => {
  const refused = (input: string, message: string) => {
    expect(parseWebhookUrl(input, STRICT)).toEqual({ ok: false, message });
  };

  it.each([["app.example.com/hook"], ["not a url"], [""], ["ftp://app.example.com/hook"], ["javascript:alert(1)"]])(
    "not an absolute https URL: %s",
    (input) => {
      const result = parseWebhookUrl(input, STRICT);
      expect(result.ok).toBe(false);
    },
  );

  it("http without the insecure flag", () => refused("http://app.example.com/hook", WEBHOOK_URL_MESSAGES.https));

  it("credentials in the URL", () => {
    refused("https://user:pass@app.example.com/hook", WEBHOOK_URL_MESSAGES.credentials);
    refused("https://user@app.example.com/hook", WEBHOOK_URL_MESSAGES.credentials);
  });

  it.each(["https://localhost/hook", "https://LOCALHOST./hook", "https://api.localhost/hook"])(
    "localhost: %s",
    (input) => refused(input, WEBHOOK_URL_MESSAGES.localhost),
  );

  it.each(["https://intranet/hook", "https://x.local/hook", "https://db.internal/hook", "https://nas.home.arpa/"])(
    "names without a public domain: %s",
    (input) => refused(input, WEBHOOK_URL_MESSAGES.publicName),
  );

  it.each([
    "https://127.0.0.1/",
    "https://127.1/",
    "https://0x7f000001/",
    "https://2130706433/",
    "https://0177.0.0.1/",
    "https://0.0.0.0/",
    "https://10.0.0.5/",
    "https://172.16.0.1/",
    "https://172.31.255.255/",
    "https://192.168.1.1/",
    "https://169.254.169.254/latest/meta-data/",
    "https://100.64.0.1/",
    "https://198.18.0.1/",
    "https://224.0.0.1/",
    "https://255.255.255.255/",
    "https://[::1]/",
    "https://[::]/",
    "https://[0:0:0:0:0:0:0:1]/",
    "https://[::ffff:127.0.0.1]/",
    "https://[::ffff:169.254.169.254]/",
    "https://[::127.0.0.1]/",
    "https://[64:ff9b::10.0.0.1]/",
    "https://[fc00::1]/",
    "https://[fd12:3456::1]/",
    "https://[fe80::1]/",
    "https://[ff02::1]/",
    "https://[2001:db8::1]/",
  ])("private, reserved or metadata address: %s", (input) => refused(input, WEBHOOK_URL_MESSAGES.privateNetwork));

  it("does not refuse public neighbours of private ranges", () => {
    for (const host of ["172.15.255.255", "172.32.0.1", "11.0.0.1", "169.255.0.1", "100.128.0.1"]) {
      expect(parseWebhookUrl(`https://${host}/`, STRICT).ok).toBe(true);
    }
  });

  it("longer than 2048 characters", () => {
    refused(`https://app.example.com/${"a".repeat(2048)}`, WEBHOOK_URL_MESSAGES.tooLong);
  });
});

describe("parseWebhookUrl: options", () => {
  it("WEBHOOK_ALLOW_INSECURE_URLS accepts http and localhost (local receiver)", () => {
    expect(parseWebhookUrl("http://localhost:9999/hook", INSECURE)).toMatchObject({
      ok: true,
      url: "http://localhost:9999/hook",
    });
    expect(parseWebhookUrl("http://127.0.0.1:9999/", INSECURE).ok).toBe(true);
  });

  it("the insecure flag still refuses credentials and other schemes", () => {
    expect(parseWebhookUrl("http://u:p@localhost/", INSECURE).ok).toBe(false);
    expect(parseWebhookUrl("ftp://localhost/", INSECURE).ok).toBe(false);
  });

  it("WEBHOOK_ALLOWED_HOSTS only lets the listed hosts through", () => {
    const options = { allowInsecureUrls: false, allowedHosts: ["hooks.example.com"] };
    expect(parseWebhookUrl("https://hooks.example.com/x", options).ok).toBe(true);
    expect(parseWebhookUrl("https://HOOKS.example.com./x", options).ok).toBe(true);
    expect(parseWebhookUrl("https://other.example.com/x", options)).toEqual({
      ok: false,
      message: WEBHOOK_URL_MESSAGES.notAllowed,
    });
  });

  it("the allowlist does not bypass the private address rules", () => {
    const options = { allowInsecureUrls: false, allowedHosts: ["127.0.0.1"] };
    expect(parseWebhookUrl("https://127.0.0.1/", options).ok).toBe(false);
  });
});

describe("webhookUrlHost", () => {
  it("keeps only the host, never the path or query (they can hold a token)", () => {
    expect(webhookUrlHost("https://hooks.slack.com/services/T0/B0/secret?token=abc")).toBe("hooks.slack.com");
    expect(webhookUrlHost("garbage")).toBe("invalid");
  });
});
