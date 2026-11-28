import { describe, it, expect } from "vitest";
import { Webhook } from "standardwebhooks";
import { buildSignatureHeader, generateSecret, signWebhook } from "@/webhooks/webhook-signature";

const nowSeconds = () => Math.floor(Date.now() / 1000);
const BODY = JSON.stringify({ type: "email.sent", data: { emailId: "e1", status: "sent" } });

function headers(id: string, timestamp: number, signature: string) {
  return { "webhook-id": id, "webhook-timestamp": String(timestamp), "webhook-signature": signature };
}

function decodedLength(secret: string): number {
  return atob(secret.slice("whsec_".length)).length;
}

describe("generateSecret", () => {
  it("is whsec_ followed by the standard base64 of 32 bytes", () => {
    const secret = generateSecret();
    expect(secret).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/);
    expect(decodedLength(secret)).toBe(32);
  });

  it("is different every time", () => {
    const secrets = new Set(Array.from({ length: 50 }, generateSecret));
    expect(secrets.size).toBe(50);
  });
});

describe("signWebhook", () => {
  it("produces exactly what the official library's sign() produces for the same input", async () => {
    const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSwzXk0bQ7fs9Q=";
    const timestamp = 1614265330;
    const body = '{"test": 2432232314}';

    const ours = await signWebhook(secret, "msg_p5jXN8AQM9LWM0D4loKWxJek", timestamp, body);
    const theirs = new Webhook(secret).sign("msg_p5jXN8AQM9LWM0D4loKWxJek", new Date(timestamp * 1000), body);
    expect(ours).toBe(theirs);
  });

  it("is accepted by the official standardwebhooks library", async () => {
    const secret = generateSecret();
    const timestamp = nowSeconds();
    const signature = await signWebhook(secret, "msg_d1", timestamp, BODY);

    const payload = new Webhook(secret).verify(BODY, headers("msg_d1", timestamp, signature));
    expect(payload).toEqual(JSON.parse(BODY));
  });

  it("is rejected when one character of the body changes", async () => {
    const secret = generateSecret();
    const timestamp = nowSeconds();
    const signature = await signWebhook(secret, "msg_d1", timestamp, BODY);

    expect(() =>
      new Webhook(secret).verify(BODY.replace("sent", "sEnt"), headers("msg_d1", timestamp, signature)),
    ).toThrow();
  });

  it("is rejected when the webhook-id changes (the id is signed)", async () => {
    const secret = generateSecret();
    const timestamp = nowSeconds();
    const signature = await signWebhook(secret, "msg_d1", timestamp, BODY);

    expect(() => new Webhook(secret).verify(BODY, headers("msg_d2", timestamp, signature))).toThrow();
  });

  it("is rejected with another secret", async () => {
    const timestamp = nowSeconds();
    const signature = await signWebhook(generateSecret(), "msg_d1", timestamp, BODY);

    expect(() => new Webhook(generateSecret()).verify(BODY, headers("msg_d1", timestamp, signature))).toThrow();
  });

  it("is rejected when the timestamp is more than 5 minutes old (replay)", async () => {
    const secret = generateSecret();
    const old = nowSeconds() - 10 * 60;
    const signature = await signWebhook(secret, "msg_d1", old, BODY);

    expect(() => new Webhook(secret).verify(BODY, headers("msg_d1", old, signature))).toThrow();
  });

  it("refuses a secret without the whsec_ prefix", async () => {
    await expect(signWebhook("MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSwzXk0bQ7fs9Q=", "msg_d1", 1, BODY)).rejects.toThrow(
      /whsec_/,
    );
  });
});

describe("buildSignatureHeader", () => {
  it("signs with one secret as a single v1 signature", async () => {
    const header = await buildSignatureHeader([generateSecret()], "msg_d1", nowSeconds(), BODY);
    expect(header).toMatch(/^v1,[A-Za-z0-9+/]+=*$/);
  });

  it("during a rotation, verifies with the new secret and with the old one", async () => {
    const fresh = generateSecret();
    const previous = generateSecret();
    const timestamp = nowSeconds();
    const header = await buildSignatureHeader([fresh, previous], "msg_d1", timestamp, BODY);

    expect(header.split(" ")).toHaveLength(2);
    expect(() => new Webhook(fresh).verify(BODY, headers("msg_d1", timestamp, header))).not.toThrow();
    expect(() => new Webhook(previous).verify(BODY, headers("msg_d1", timestamp, header))).not.toThrow();
    expect(() => new Webhook(generateSecret()).verify(BODY, headers("msg_d1", timestamp, header))).toThrow();
  });

  it("needs at least one secret", async () => {
    await expect(buildSignatureHeader([], "msg_d1", nowSeconds(), BODY)).rejects.toThrow();
  });
});
