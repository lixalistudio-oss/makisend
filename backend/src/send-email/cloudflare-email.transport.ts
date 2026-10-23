import type { SmtpCheckResult, SmtpSendResult, TestEmail } from "@/smtp-config/smtp-connection";
import type { EmailInput, EmailSendResult, IEmailTransport } from "./send-email.types";

/**
 * Sends through the Worker's Cloudflare `send_email` binding instead of SMTP. Used for the
 * configurations whose host is Cloudflare Email Service (see `isCloudflareEmailHost`): the
 * binding needs no credentials, and the `from` domain must be onboarded to Email Sending.
 */
export class CloudflareEmailTransport implements IEmailTransport {
  constructor(
    private readonly binding: SendEmail | undefined,
    private readonly senderEmail: string,
  ) {}

  async send(input: EmailInput): Promise<EmailSendResult> {
    if (!this.binding) throw new Error("The EMAIL (send_email) binding is not configured on this Worker");
    const { messageId } = await this.binding.send({
      from: this.senderEmail,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    return { messageId };
  }
}

/** The binding has no "verify": the check can only say that it exists. */
export function checkCloudflareEmail(binding: SendEmail | undefined): SmtpCheckResult {
  if (binding) return { ok: true };
  return {
    ok: false,
    reason: "unknown",
    message: "This Worker has no EMAIL (send_email) binding, so it cannot send through Cloudflare Email Service.",
  };
}

/** The refusal's own words on one line and bounded: it is shown to a person. */
function oneLine(text: string): string {
  const cleaned = Array.from(text, (ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch)).join("");
  return cleaned.trim().slice(0, 200);
}

/** Same contract as `sendTestEmail`: never throws, and the message names no secret. */
export async function sendTestViaCloudflare(
  binding: SendEmail | undefined,
  senderEmail: string,
  email: TestEmail,
): Promise<SmtpSendResult> {
  const missing = checkCloudflareEmail(binding);
  if (!missing.ok) return missing;
  try {
    const { messageId } = await new CloudflareEmailTransport(binding, senderEmail).send({ ...email, html: "" });
    return { ok: true, messageId };
  } catch (err) {
    const detail = err instanceof Error ? oneLine(err.message) : "";
    return {
      ok: false,
      reason: "rejected",
      message: `Cloudflare Email Service refused the message${detail ? `: "${detail}"` : ""}. Check that the sender domain is onboarded to Email Sending and that the sender address uses it.`,
    };
  }
}
