import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildMessageId, cleanReason, emailIdFromMessageId } from "@/bounce-webhooks/correlation";
import { isDeadAddress } from "@/bounce-webhooks/providers/common";
import { PROVIDERS } from "@/bounce-webhooks/providers";
import {
  bytesToBase64,
  derToRawEcdsaSignature,
  importEcdsaP256PublicKey,
  verifyEcdsaP256Sha256,
} from "@/bounce-webhooks/signatures";
import type { WebhookRequest } from "@/bounce-webhooks/bounce-webhooks.types";

const request = (headers: Record<string, string> = {}, rawBody = ""): WebhookRequest => ({
  header: (name) => headers[name.toLowerCase()] ?? headers[name],
  rawBody,
});

describe("correlation", () => {
  it("builds the Message-ID on the sender's domain and reads the id back", () => {
    const messageId = buildMessageId("ckabc123def456ghi789jkl0", "billing@Shop.Example");
    expect(messageId).toBe("<ckabc123def456ghi789jkl0@shop.example>");
    expect(emailIdFromMessageId(messageId)).toBe("ckabc123def456ghi789jkl0");
    expect(emailIdFromMessageId("ckabc123def456ghi789jkl0@shop.example")).toBe("ckabc123def456ghi789jkl0");
  });

  it("ignores Message-IDs that are not MakiSend's", () => {
    expect(emailIdFromMessageId("<14c5d75ce93.dfd.64b469@ismtpd-555>")).toBeNull();
    expect(emailIdFromMessageId("<a@b>")).toBeNull();
    expect(emailIdFromMessageId(null)).toBeNull();
  });

  it("never keeps an address, a line break or more than 500 characters in a reason", () => {
    expect(cleanReason("550 5.1.1 <ghost@example.com>:\r\nUser unknown")).toBe("550 5.1.1 <[address]>: User unknown");
    expect(cleanReason("x".repeat(600))).toHaveLength(500);
  });
});

describe("isDeadAddress", () => {
  it("lets the status code win over the provider's label", () => {
    expect(isDeadAddress("5.1.1", false)).toBe(true);
    expect(isDeadAddress("5.7.1", true)).toBe(false);
    expect(isDeadAddress("5.2.2", true)).toBe(false);
    expect(isDeadAddress("5.5.0", true)).toBe(true);
    expect(isDeadAddress(null, false)).toBe(false);
  });
});

describe("ECDSA DER signatures", () => {
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKey = bytesToBase64(keys.publicKey.export({ type: "spki", format: "der" }));

  it("verifies a real DER signature and refuses another message", async () => {
    const key = await importEcdsaP256PublicKey(publicKey);
    expect(key).not.toBeNull();
    const der = sign("sha256", Buffer.from("1700000000[]"), keys.privateKey);
    expect(await verifyEcdsaP256Sha256(key!, der, "1700000000[]")).toBe(true);
    expect(await verifyEcdsaP256Sha256(key!, der, "1700000001[]")).toBe(false);
  });

  it("rejects malformed DER and keys", async () => {
    expect(derToRawEcdsaSignature(new Uint8Array([0x30, 0x02, 0x02, 0x00]))).toBeNull();
    expect(derToRawEcdsaSignature(new Uint8Array([0x31, 0x00]))).toBeNull();
    expect(await importEcdsaP256PublicKey("not base64 !")).toBeNull();
    expect(await importEcdsaP256PublicKey(bytesToBase64(new Uint8Array(32)))).toBeNull();
  });
});

describe("provider event mapping", () => {
  it("Resend: delays, complaints and its own suppressions", () => {
    const parse = (type: string, data: Record<string, unknown> = {}) =>
      PROVIDERS.resend.parse({ type, data: { to: ["a@example.com"], message_id: "<x@y>", ...data } }, request({ "svix-id": "msg_1" }));

    expect(parse("email.delivery_delayed")[0]).toMatchObject({ kind: "deferred", hard: false });
    expect(parse("email.complained")[0]).toMatchObject({ kind: "complained" });
    expect(parse("email.suppressed")[0]).toMatchObject({ kind: "bounced", hard: true });
    expect(parse("email.bounced", { bounce: { type: "Transient", subType: "MailboxFull" } })[0]).toMatchObject({
      kind: "bounced",
      hard: false,
    });
    expect(parse("email.bounced", { bounce: { type: "Permanent", subType: "ContentRejected" } })[0]).toMatchObject({
      hard: false,
    });
    expect(parse("email.opened")).toEqual([]);
  });

  it("Postmark: record types and bounce types", () => {
    const parse = (body: Record<string, unknown>) => PROVIDERS.postmark.parse(body, request());
    expect(parse({ RecordType: "Bounce", ID: 1, Type: "Transient", Email: "a@example.com" })[0]).toMatchObject({ kind: "deferred" });
    expect(parse({ RecordType: "Bounce", ID: 2, Type: "SoftBounce", Email: "a@example.com" })[0]).toMatchObject({
      kind: "bounced",
      hard: false,
    });
    expect(parse({ RecordType: "Bounce", ID: 3, Type: "AutoResponder", Email: "a@example.com" })).toEqual([]);
    expect(parse({ RecordType: "SpamComplaint", ID: 4, Email: "a@example.com" })[0]).toMatchObject({
      kind: "complained",
      eventKey: "complaint:4",
    });
    expect(parse({ RecordType: "Delivery", MessageID: "m-1", Recipient: "a@example.com" })[0]).toMatchObject({
      kind: "delivered",
      eventKey: "delivery:m-1",
    });
  });

  it("Mailgun: complaints, and permanent failures that are not about the address", () => {
    const parse = (data: Record<string, unknown>) => PROVIDERS.mailgun.parse({ "event-data": { id: "e", recipient: "a@example.com", ...data } }, request());
    expect(parse({ event: "complained" })[0]).toMatchObject({ kind: "complained" });
    expect(
      parse({ event: "failed", severity: "permanent", reason: "bounce", "delivery-status": { code: 550, "enhanced-code": "5.7.1", "bounce-type": "hard" } })[0],
    ).toMatchObject({ kind: "bounced", hard: false, reason: "550 · 5.7.1 · bounce" });
    expect(parse({ event: "failed", severity: "permanent", reason: "suppress-bounce" })[0]).toMatchObject({ hard: true });
  });

  it("only sends correlation headers the provider echoes", () => {
    expect(PROVIDERS.resend.correlationHeaders("id")).toEqual({});
    expect(PROVIDERS.mailgun.correlationHeaders("id")).toEqual({ "X-Mailgun-Variables": '{"makisend_email_id":"id"}' });
    expect(PROVIDERS.postmark.correlationHeaders("id")).toEqual({ "X-PM-Metadata-makisend-email-id": "id" });
  });
});
