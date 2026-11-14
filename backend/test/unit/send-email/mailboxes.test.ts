import { describe, it, expect } from "vitest";
import { SendEmailDto, SendTemplateEmailDto } from "@/send-email/send-email.dto";
import {
  MAX_COPY_RECIPIENTS,
  toCloudflareMailboxes,
  toMailboxArray,
  toNodemailerMailboxes,
} from "@/send-email/mailboxes";

const inline = {
  to: "dest@example.com",
  subject: "Votre reçu",
  text: "Merci pour votre commande, voici le reçu.",
  html: "<p>Merci pour votre commande.</p>",
};

const parse = (payload: Record<string, unknown>) => SendEmailDto.safeParse({ ...inline, ...payload });

describe("copies and reply address (cc, bcc, reply_to)", () => {
  it("leaves all three absent when the caller sends none", () => {
    const result = parse({});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.cc).toBeUndefined();
    expect(result.data.bcc).toBeUndefined();
    expect(result.data.reply_to).toBeUndefined();
  });

  it("accepts a bare address and a named address, normalised to one shape", () => {
    const result = parse({
      cc: ["plain@example.com", { email: "named@example.com", name: "Service" }],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.cc).toEqual([
      { email: "plain@example.com" },
      { email: "named@example.com", name: "Service" },
    ]);
  });

  it("accepts reply_to as a single address or as a list", () => {
    const single = parse({ reply_to: "support@example.com" });
    expect(single.success).toBe(true);
    if (single.success) {
      expect(toMailboxArray(single.data.reply_to)).toEqual([{ email: "support@example.com" }]);
    }

    const list = parse({ reply_to: ["a@example.com", "b@example.com"] });
    expect(list.success).toBe(true);
    if (list.success) {
      expect(toMailboxArray(list.data.reply_to)).toHaveLength(2);
    }
  });

  it("refuses an empty copy list, an invalid address and a line break", () => {
    expect(parse({ cc: [] }).success).toBe(false);
    expect(parse({ bcc: ["not-an-email"] }).success).toBe(false);
    // A CR/LF in a header value is how extra headers get injected.
    expect(parse({ cc: ["a@example.com\r\nBcc: victim@example.com"] }).success).toBe(false);
  });

  it("refuses more copies than the cap allows", () => {
    const tooMany = Array.from({ length: MAX_COPY_RECIPIENTS + 1 }, (_, i) => `c${i}@example.com`);
    expect(parse({ cc: tooMany }).success).toBe(false);
    expect(parse({ cc: tooMany.slice(0, MAX_COPY_RECIPIENTS) }).success).toBe(true);
  });

  it("refuses an unknown field inside a named address", () => {
    expect(parse({ cc: [{ email: "a@example.com", name: "A", role: "admin" }] }).success).toBe(false);
  });

  it("accepts the same three fields on the template shape", () => {
    const result = SendTemplateEmailDto.safeParse({
      to: "dest@example.com",
      templateId: "tpl-1",
      cc: ["cc@example.com"],
      reply_to: "support@example.com",
    });
    expect(result.success).toBe(true);
  });
});

describe("mailbox helpers", () => {
  it("turns a single reply address into a list, and keeps absence as absence", () => {
    expect(toMailboxArray({ email: "a@example.com" })).toEqual([{ email: "a@example.com" }]);
    expect(toMailboxArray([{ email: "a@example.com" }])).toEqual([{ email: "a@example.com" }]);
    expect(toMailboxArray(undefined)).toBeUndefined();
  });

  it("maps to each transport's own address shape", () => {
    const mailboxes = [{ email: "a@example.com", name: "A" }, { email: "b@example.com" }];

    // nodemailer does its own header quoting on { name, address }.
    expect(toNodemailerMailboxes(mailboxes)).toEqual([
      { name: "A", address: "a@example.com" },
      { name: "", address: "b@example.com" },
    ]);
    // The Worker binding wants { name, email }, name always present.
    expect(toCloudflareMailboxes(mailboxes)).toEqual([
      { name: "A", email: "a@example.com" },
      { name: "", email: "b@example.com" },
    ]);
  });
});
