import { describe, it, expect, vi } from "vitest";
import { loadEmailForSending } from "@/send-email/send-email.loader";
import { encrypt } from "@/core/crypto";
import type { IEmailRepository, StoredEmail } from "@/send-email/send-email.types";

const AES_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

async function repositoryFor(stored: Partial<StoredEmail>): Promise<IEmailRepository> {
  return {
    getEmailForSending: vi.fn().mockResolvedValue({
      to: await encrypt("dest@example.com", AES_KEY),
      subject: "Sujet",
      text: await encrypt("Corps du message assez long.", AES_KEY),
      html: await encrypt("<p>Corps</p>", AES_KEY),
      smtpConfigId: "smtp-1",
      cc: null,
      bcc: null,
      replyTo: null,
      ...stored,
    }),
    getEmailAttachments: vi.fn().mockResolvedValue([]),
  } as unknown as IEmailRepository;
}

describe("loadEmailForSending", () => {
  it("returns no copy keys at all when the stored row has none", async () => {
    const email = await loadEmailForSending(await repositoryFor({}), AES_KEY, "email-1");

    // Absent, not empty: the transports then build exactly the message they built before.
    expect(email).toEqual({
      to: "dest@example.com",
      subject: "Sujet",
      text: "Corps du message assez long.",
      html: "<p>Corps</p>",
      smtpConfigId: "smtp-1",
    });
    expect("cc" in email).toBe(false);
    expect("bcc" in email).toBe(false);
    expect("replyTo" in email).toBe(false);
  });

  it("decrypts the copies and the reply address stored at enqueue time", async () => {
    const repository = await repositoryFor({
      cc: await encrypt(JSON.stringify([{ email: "cc@example.com", name: "Copie" }]), AES_KEY),
      bcc: await encrypt(JSON.stringify([{ email: "bcc@example.com" }]), AES_KEY),
      replyTo: await encrypt(JSON.stringify([{ email: "support@example.com" }]), AES_KEY),
    });

    const email = await loadEmailForSending(repository, AES_KEY, "email-1");

    expect(email.cc).toEqual([{ email: "cc@example.com", name: "Copie" }]);
    expect(email.bcc).toEqual([{ email: "bcc@example.com" }]);
    expect(email.replyTo).toEqual([{ email: "support@example.com" }]);
  });
});
