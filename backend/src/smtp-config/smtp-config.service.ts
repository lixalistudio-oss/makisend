import type { KeyMaterial } from "@/core/crypto";
import type { IEmailRepository } from "@/send-email/send-email.types";
import { checkCloudflareEmail, sendTestViaCloudflare } from "@/send-email/cloudflare-email.transport";
import { encrypt, decrypt } from "@/core/crypto";
import { AppError } from "@/core/errors";
import { pinoLogger } from "@/core/logger";
import type { ISmtpConfigRepository, SmtpConfigRecord } from "./smtp-config.types";
import { defaultSecurityFor, isCloudflareEmailHost, type SmtpSecurity } from "./smtp-host";
import {
  checkSmtpConnection,
  sendTestEmail,
  type SmtpCheckResult,
  type SmtpSendResult,
  type TestEmail,
} from "./smtp-connection";
import { DohDnsResolver, runDnsCheck, type DnsCheckResult, type IDnsResolver } from "./dns-check";
import { providerFor } from "@/bounce-webhooks/providers";
import type { BounceWebhookProviderId } from "@/bounce-webhooks/bounce-webhooks.types";

/** Why a secret was refused, per provider: where to find the right value. */
export const BOUNCE_WEBHOOK_SECRET_HINTS: Readonly<Record<BounceWebhookProviderId, string>> = {
  resend: "Paste the webhook's signing secret from Resend (it starts with whsec_).",
  sendgrid: "Paste the verification key of SendGrid's Signed Event Webhook (a base64 P-256 public key).",
  mailgun: "Paste Mailgun's HTTP webhook signing key (8 to 256 characters, no spaces).",
  postmark: "Choose a password of 16 to 256 characters without spaces, and set the same one as the webhook's Basic auth password in Postmark.",
};

export interface SmtpConfigServiceOptions {
  /** Cloudflare Email Service binding: the only way a Worker reaches smtp.mx.cloudflare.net. */
  emailBinding?: SendEmail;
  /** Where test sends are recorded (source "test"). Without it, tests are not logged. */
  emailLogs?: IEmailRepository;
  /** Reads the sender domain's records for the DNS check. Default: DNS-over-HTTPS. */
  dnsResolver?: IDnsResolver;
}

/** A failure to write the log must not hide the result of the send the person asked for. */
async function bestEffort(step: string, emailId: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (err) {
    pinoLogger.error({ err, emailId, step }, "Could not record the test email in the logs");
  }
}

export class SmtpConfigService {
  constructor(
    private readonly smtpConfigRepo: ISmtpConfigRepository,
    private readonly aesKey: KeyMaterial,
    private readonly options: SmtpConfigServiceOptions = {},
  ) {}

  /** Connection check that goes through the send_email binding for Cloudflare Email Service. */
  private async check(config: Parameters<typeof checkSmtpConnection>[0]): Promise<SmtpCheckResult> {
    if (isCloudflareEmailHost(config.smtpHostName)) return checkCloudflareEmail(this.options.emailBinding);
    return checkSmtpConnection(config);
  }

  private async decryptRecord(record: SmtpConfigRecord): Promise<SmtpConfigRecord> {
    const [smtpHostname, smtpUsername, smtpPassword, senderEmail] = await Promise.all([
      decrypt(record.smtpHostname, this.aesKey),
      decrypt(record.smtpUsername, this.aesKey),
      decrypt(record.smtpPassword, this.aesKey),
      decrypt(record.senderEmail, this.aesKey),
    ]);
    return { ...record, smtpHostname, smtpUsername, smtpPassword, senderEmail };
  }

  async findAllByUser(userId: string): Promise<SmtpConfigRecord[]> {
    pinoLogger.info({ userId }, "Fetching all SMTP configs for user");
    const records = await this.smtpConfigRepo.findByUserId(userId);
    return Promise.all(records.map((r) => this.decryptRecord(r)));
  }

  async findByIdAndUser(id: string, userId: string): Promise<SmtpConfigRecord> {
    pinoLogger.info({ id, userId }, "Fetching SMTP config by ID");
    const config = await this.smtpConfigRepo.findById(id);
    if (!config) {
      throw new AppError(404, "SMTP config not found");
    }
    if (config.userId !== userId) {
      throw new AppError(403, "Not authorized to access this SMTP config");
    }
    return this.decryptRecord(config);
  }

  async create(
    userId: string,
    input: {
      smtpHostname: string;
      smtpPort: number;
      smtpSecurity: SmtpSecurity;
      smtpUsername: string;
      smtpPassword: string;
      senderEmail: string;
    },
  ): Promise<SmtpConfigRecord> {
    pinoLogger.info(
      { userId, senderEmail: input.senderEmail, smtpPort: input.smtpPort, smtpSecurity: input.smtpSecurity },
      "Creating SMTP config",
    );

    const [encryptedHostname, encryptedUsername, encryptedPassword, encryptedSenderEmail] =
      await Promise.all([
        encrypt(input.smtpHostname, this.aesKey),
        encrypt(input.smtpUsername, this.aesKey),
        encrypt(input.smtpPassword, this.aesKey),
        encrypt(input.senderEmail, this.aesKey),
      ]);

    const config = await this.smtpConfigRepo.create(userId, {
      smtpHostname: encryptedHostname,
      smtpPort: input.smtpPort,
      smtpSecurity: input.smtpSecurity,
      smtpUsername: encryptedUsername,
      smtpPassword: encryptedPassword,
      senderEmail: encryptedSenderEmail,
    });

    pinoLogger.info({ configId: config.id }, "SMTP config created successfully");
    return this.decryptRecord(config);
  }

  async update(
    id: string,
    userId: string,
    updates: {
      smtpHostname?: string;
      smtpPort?: number;
      smtpSecurity?: SmtpSecurity;
      smtpUsername?: string;
      smtpPassword?: string;
      senderEmail?: string;
      isActive?: boolean;
    },
  ): Promise<SmtpConfigRecord> {
    pinoLogger.info({ id, userId }, "Updating SMTP config");

    const existing = await this.smtpConfigRepo.findById(id);
    if (!existing) {
      throw new AppError(404, "SMTP config not found");
    }
    if (existing.userId !== userId) {
      throw new AppError(403, "Not authorized to update this SMTP config");
    }

    const encryptedUpdates: Record<string, string | number | boolean> = {};

    // A new port without an explicit security takes that port's usual mode, so
    // changing 465 to 587 cannot leave an implicit-TLS row on a STARTTLS port.
    if (updates.smtpPort !== undefined) {
      encryptedUpdates.smtpPort = updates.smtpPort;
      encryptedUpdates.smtpSecurity = updates.smtpSecurity ?? defaultSecurityFor(updates.smtpPort);
    } else if (updates.smtpSecurity !== undefined) {
      encryptedUpdates.smtpSecurity = updates.smtpSecurity;
    }

    if (updates.smtpHostname) {
      encryptedUpdates.smtpHostname = await encrypt(updates.smtpHostname, this.aesKey);
    }
    if (updates.smtpUsername) {
      encryptedUpdates.smtpUsername = await encrypt(updates.smtpUsername, this.aesKey);
    }
    if (updates.smtpPassword) {
      encryptedUpdates.smtpPassword = await encrypt(updates.smtpPassword, this.aesKey);
    }
    if (updates.senderEmail) {
      encryptedUpdates.senderEmail = await encrypt(updates.senderEmail, this.aesKey);
    }
    if (updates.isActive !== undefined) {
      encryptedUpdates.isActive = updates.isActive;
    }

    const config = await this.smtpConfigRepo.update(id, encryptedUpdates);
    pinoLogger.info({ id }, "SMTP config updated successfully");
    return this.decryptRecord(config);
  }

  /**
   * Connects the provider's bounce webhook: POST /webhooks/bounces/:id then accepts requests
   * verified with `secret`, and each send through this configuration carries the provider's tag.
   */
  async setBounceWebhook(
    id: string,
    userId: string,
    input: { provider: BounceWebhookProviderId; secret: string },
  ): Promise<SmtpConfigRecord> {
    await this.findByIdAndUser(id, userId);
    const provider = providerFor(input.provider);
    if (!(await provider.isValidSecret(input.secret))) {
      throw new AppError(400, BOUNCE_WEBHOOK_SECRET_HINTS[input.provider]);
    }
    const config = await this.smtpConfigRepo.update(id, {
      bounceWebhookProvider: input.provider,
      bounceWebhookSecret: await encrypt(input.secret.trim(), this.aesKey),
    });
    pinoLogger.info({ id, provider: input.provider }, "Bounce webhook connected");
    return this.decryptRecord(config);
  }

  /** Disconnects the bounce webhook: its requests are refused from now on. */
  async removeBounceWebhook(id: string, userId: string): Promise<SmtpConfigRecord> {
    await this.findByIdAndUser(id, userId);
    const config = await this.smtpConfigRepo.update(id, { bounceWebhookProvider: null, bounceWebhookSecret: null });
    pinoLogger.info({ id }, "Bounce webhook disconnected");
    return this.decryptRecord(config);
  }

  async checkConnection(input: {
    smtpHostname: string;
    smtpPort: number;
    smtpSecurity: SmtpSecurity;
    smtpUsername: string;
    smtpPassword: string;
  }): Promise<SmtpCheckResult> {
    return this.check({
      smtpHostName: input.smtpHostname,
      smtpPort: input.smtpPort,
      smtpSecurity: input.smtpSecurity,
      smtpUsername: input.smtpUsername,
      smtpPassword: input.smtpPassword,
    });
  }

  async checkConnectionById(id: string, userId: string): Promise<SmtpCheckResult> {
    const config = await this.findByIdAndUser(id, userId);
    return this.check(this.toTransportConfig(config));
  }

  /**
   * Sends a test email and records it in the logs with source "test" and this configuration's
   * id, so it shows up in Logs (filtered by configuration) but never in the dashboard totals.
   */
  async sendTest(id: string, userId: string, email: TestEmail): Promise<SmtpSendResult> {
    const config = await this.findByIdAndUser(id, userId);
    const logs = this.options.emailLogs;
    const emailId = crypto.randomUUID();
    const startedAt = performance.now();

    if (logs) {
      await bestEffort("create", emailId, async () => {
        const encryptedTo = await encrypt(email.to, this.aesKey);
        await logs.createPendingEmailLog(emailId, userId, encryptedTo, email.subject, null, {
          source: "test",
          smtpConfigId: id,
        });
        await logs.saveEmailHistory(emailId, "processing");
      });
    }

    const transport = this.toTransportConfig(config);
    const result = isCloudflareEmailHost(transport.smtpHostName)
      ? await sendTestViaCloudflare(this.options.emailBinding, transport.senderEmail, email)
      : await sendTestEmail(transport, email);

    if (logs) {
      await bestEffort("result", emailId, async () => {
        if (result.ok) {
          await logs.saveEmailHistory(emailId, "sent", undefined, 1);
          await logs.completeEmailLog(
            emailId,
            result.messageId,
            new Date().toISOString(),
            Math.round(performance.now() - startedAt),
          );
        } else {
          // The message names no secret (see classifySmtpError), so it is safe to store and show.
          await logs.saveEmailHistory(emailId, "failed", result.message, 1);
        }
      });
    }
    return result;
  }

  /** SPF, DKIM, DMARC and MX of the configuration's sender domain (public DNS only). */
  async checkDnsById(id: string, userId: string, dkimSelector?: string): Promise<DnsCheckResult> {
    const config = await this.findByIdAndUser(id, userId);
    const resolver = this.options.dnsResolver ?? new DohDnsResolver();
    return runDnsCheck(resolver, config.senderEmail, dkimSelector ? { dkimSelector } : {});
  }

  async checkAll(): Promise<{ checked: number; healthy: number }> {
    const records = await this.smtpConfigRepo.findAll();
    let healthy = 0;

    for (const record of records) {
      let result: SmtpCheckResult;
      try {
        const decrypted = await this.decryptRecord(record);
        result = await this.check(this.toTransportConfig(decrypted));
      } catch (err) {
        pinoLogger.error({ err, configId: record.id }, "SMTP health check could not read the configuration");
        result = {
          ok: false,
          reason: "unknown",
          message: "The stored SMTP configuration could not be read.",
        };
      }

      if (result.ok) healthy++;

      try {
        await this.smtpConfigRepo.update(record.id, {
          lastCheckAt: new Date(),
          lastCheckOk: result.ok,
          lastCheckError: result.ok ? null : result.message,
        });
      } catch (err) {
        pinoLogger.error({ err, configId: record.id }, "SMTP health check result could not be stored");
      }
    }

    return { checked: records.length, healthy };
  }

  private toTransportConfig(config: SmtpConfigRecord) {
    return {
      smtpHostName: config.smtpHostname,
      smtpPort: config.smtpPort,
      smtpSecurity: config.smtpSecurity,
      smtpUsername: config.smtpUsername,
      smtpPassword: config.smtpPassword,
      senderEmail: config.senderEmail,
    };
  }

  async delete(id: string, userId: string): Promise<void> {
    pinoLogger.info({ id, userId }, "Deleting SMTP config");

    const existing = await this.smtpConfigRepo.findById(id);
    if (!existing) {
      throw new AppError(404, "SMTP config not found");
    }
    if (existing.userId !== userId) {
      throw new AppError(403, "Not authorized to delete this SMTP config");
    }

    await this.smtpConfigRepo.delete(id);
    pinoLogger.info({ id }, "SMTP config deleted successfully");
  }
}
