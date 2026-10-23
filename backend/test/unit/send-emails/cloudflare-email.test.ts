/**
 * The Cloudflare Email Service special case: a configuration whose host is smtp.mx.cloudflare.net
 * is sent through the Worker's `send_email` binding, because a Worker cannot open an SMTP socket
 * to Cloudflare. The binding is a small typed implementation of `SendEmail`, not a mock of a library.
 *
 *  C1  Only that exact host (any case, any padding) takes the binding path; other hosts stay on SMTP.
 *  C2  A send hands the binding the sender, recipient, subject and both bodies, and returns its message id.
 *  C3  A missing binding is a named failure, not a crash; a binding that refuses is reported without a secret.
 */
import { describe, expect, it } from "vitest";
import {
  CloudflareEmailTransport,
  checkCloudflareEmail,
  sendTestViaCloudflare,
} from "@/send-email/cloudflare-email.transport";
import { CLOUDFLARE_EMAIL_HOST, isCloudflareEmailHost } from "@/smtp-config/smtp-host";

class RecordingBinding implements SendEmail {
  readonly sent: EmailMessageBuilder[] = [];

  async send(message: EmailMessage | EmailMessageBuilder): Promise<EmailSendResult> {
    this.sent.push(message as EmailMessageBuilder);
    return { messageId: "<cf-message-id@example.com>" };
  }
}

class RefusingBinding implements SendEmail {
  async send(): Promise<EmailSendResult> {
    throw new Error("sender domain is not onboarded");
  }
}

describe("isCloudflareEmailHost", () => {
  it("C1 matches Cloudflare's SMTP host only", () => {
    expect(isCloudflareEmailHost(CLOUDFLARE_EMAIL_HOST)).toBe(true);
    expect(isCloudflareEmailHost("  SMTP.MX.Cloudflare.NET ")).toBe(true);
    expect(isCloudflareEmailHost("smtp.zoho.com")).toBe(false);
    expect(isCloudflareEmailHost("smtp.mx.cloudflare.net.evil.com")).toBe(false);
    expect(isCloudflareEmailHost("cloudflare.net")).toBe(false);
  });
});

describe("CloudflareEmailTransport", () => {
  it("C2 sends through the binding and returns its message id", async () => {
    const binding = new RecordingBinding();
    const transport = new CloudflareEmailTransport(binding, "noreply@getitaja.com");

    const result = await transport.send({ to: "dest@example.com", subject: "Hi", text: "plain", html: "<p>rich</p>" });

    expect(result).toEqual({ messageId: "<cf-message-id@example.com>" });
    expect(binding.sent).toEqual([
      { from: "noreply@getitaja.com", to: "dest@example.com", subject: "Hi", text: "plain", html: "<p>rich</p>" },
    ]);
  });

  it("C3 rejects when the Worker has no binding", async () => {
    const transport = new CloudflareEmailTransport(undefined, "noreply@getitaja.com");
    await expect(transport.send({ to: "a@b.co", subject: "s", text: "t", html: "h" })).rejects.toThrow(/binding/);
  });
});

describe("check and test send", () => {
  it("C3 the check is ok with a binding and says what is missing without one", () => {
    expect(checkCloudflareEmail(new RecordingBinding())).toEqual({ ok: true });
    const missing = checkCloudflareEmail(undefined);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.message).toMatch(/send_email/);
  });

  it("C2 a test send arrives through the binding", async () => {
    const binding = new RecordingBinding();
    const result = await sendTestViaCloudflare(binding, "noreply@getitaja.com", { to: "dest@example.com", subject: "Probe", text: "x" });
    expect(result).toEqual({ ok: true, messageId: "<cf-message-id@example.com>" });
    expect(binding.sent[0]?.from).toBe("noreply@getitaja.com");
  });

  it("C3 a refusal is a value with the reason, not a throw", async () => {
    const result = await sendTestViaCloudflare(new RefusingBinding(), "noreply@getitaja.com", { to: "dest@example.com", subject: "Probe", text: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("rejected");
      expect(result.message).toMatch(/not onboarded/);
    }
  });
});
