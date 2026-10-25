import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestD1, cleanupTestD1 } from "../../helpers/d1-setup";
import { createDatabase } from "@/db/connection";
import { encrypt } from "@/core/crypto";
import { smtpConfig, user } from "@/db/schema";
import {
  decryptSmtpRecord,
  findSmtpRecord,
  resolveTransportFor,
} from "@/send-email/transport-resolver";
import type { Bindings } from "@/index";
import { CloudflareEmailTransport } from "@/send-email/cloudflare-email.transport";
import { SmtpEmailTransport } from "@/transports";
import type { Miniflare } from "miniflare";

const AES_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("SMTP transport resolution", () => {
  let mf: Miniflare;
  let env: Bindings;

  async function insertConfig(id: string, isActive: boolean, port = 465, host = "smtp.example.com") {
    const db = createDatabase(env.makisend_db);
    await db.insert(smtpConfig).values({
      id,
      userId: "resolver-user",
      smtpHostname: await encrypt(host, AES_KEY),
      smtpPort: port,
      smtpSecurity: port === 465 ? "tls" : "starttls",
      smtpUsername: await encrypt("user@example.com", AES_KEY),
      smtpPassword: await encrypt("secret", AES_KEY),
      senderEmail: await encrypt("sender@example.com", AES_KEY),
      isActive,
    });
  }

  beforeEach(async () => {
    const testD1 = await createTestD1();
    mf = testD1.mf;
    env = {
      AES_256_KEY: AES_KEY,
      makisend_db: testD1.d1,
      BETTER_AUTH_SECRET: "test-secret",
      BETTER_AUTH_URL: "http://localhost:8787",
      FRONTEND_URL: "http://localhost:4321",
    } as unknown as Bindings;

    const db = createDatabase(env.makisend_db);
    await db.insert(user).values({
      id: "resolver-user",
      name: "Resolver User",
      email: "resolver@example.com",
      emailVerified: true,
    });
  });

  afterEach(async () => {
    await cleanupTestD1(mf);
  });

  it("returns the explicitly selected active configuration", async () => {
    await insertConfig("active-config", true);
    const record = await findSmtpRecord(env, "active-config");
    expect(record?.id).toBe("active-config");
  });

  it("refuses an explicitly selected configuration when it is inactive", async () => {
    await insertConfig("inactive-config", false);

    await expect(findSmtpRecord(env, "inactive-config")).rejects.toMatchObject({
      statusCode: 409,
      message: "SMTP configuration is inactive",
    });
    await expect(resolveTransportFor(env, "inactive-config")).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it("falls back only to an active configuration when no id is supplied", async () => {
    await insertConfig("inactive-first", false);
    await insertConfig("active-second", true, 587);

    const record = await findSmtpRecord(env);
    expect(record?.id).toBe("active-second");
  });

  it("routes a Cloudflare Email Service configuration to the send_email binding, any other host to SMTP", async () => {
    await insertConfig("cf-config", true, 587, "smtp.mx.cloudflare.net");
    await insertConfig("smtp-config", true, 465);

    expect(await resolveTransportFor(env, "cf-config")).toBeInstanceOf(CloudflareEmailTransport);
    expect(await resolveTransportFor(env, "smtp-config")).toBeInstanceOf(SmtpEmailTransport);
  });

  it("decrypts the hostname and credentials with the stored port and security", async () => {
    await insertConfig("tls-config", true, 465);
    const record = await findSmtpRecord(env, "tls-config");
    expect(record).toBeDefined();

    await expect(decryptSmtpRecord(env, record!)).resolves.toEqual({
      smtpHostName: "smtp.example.com",
      smtpPort: 465,
      smtpSecurity: "tls",
      smtpUsername: "user@example.com",
      smtpPassword: "secret",
      senderEmail: "sender@example.com",
      bounceWebhookProvider: null,
    });
  });
});
