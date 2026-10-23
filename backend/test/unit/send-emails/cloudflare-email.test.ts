/**
 * The Cloudflare Email Service special case: a configuration whose host is smtp.mx.cloudflare.net
 * is sent through the Worker's `send_email` binding, because a Worker cannot open an SMTP socket
 * to Cloudflare. The binding is a small typed implementation of `SendEmail`, not a mock of a library.
 *
 *  C1  Only that exact host (any case, any padding) takes the binding path; other hosts stay on SMTP.
 *  C2  A send hands the binding the sender, recipient, subject, both bodies and the attachments, and returns its message id.
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

  it("C2 a message with attachments hands the binding each file as an attachment, in order", async () => {
    const binding = new RecordingBinding();
    const transport = new CloudflareEmailTransport(binding, "noreply@getitaja.com");
    const pdf = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]);

    await transport.send({
      to: "dest@example.com",
      subject: "Reçu",
      text: "plain",
      html: "<p>rich</p>",
      attachments: [
        { filename: "recu.pdf", contentType: "application/pdf", content: pdf },
        { filename: "detail.csv", contentType: "text/csv", content: new Uint8Array([0x61]) },
      ],
    });

    expect(binding.sent[0].attachments).toEqual([
      { disposition: "attachment", filename: "recu.pdf", type: "application/pdf", content: pdf },
      { disposition: "attachment", filename: "detail.csv", type: "text/csv", content: new Uint8Array([0x61]) },
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

  it("C2 a test send through the binding keeps its attachments", async () => {
    const binding = new RecordingBinding();
    const file = { filename: "a.pdf", contentType: "application/pdf", content: new Uint8Array([1, 2, 3]) };
    await sendTestViaCloudflare(binding, "noreply@getitaja.com", { to: "dest@example.com", subject: "Probe", text: "x", attachments: [file] });
    expect(binding.sent[0]?.attachments).toEqual([
      { disposition: "attachment", filename: "a.pdf", type: "application/pdf", content: file.content },
    ]);
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
