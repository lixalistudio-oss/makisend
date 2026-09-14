import { AppError } from "@/core/errors";
import { encrypt } from "@/core/crypto";
import { getInngestClient } from "../client";
import type { ISmtpConfigRepository } from "@/smtp-config/smtp-config.types";

interface FunctionContext {
  smtpConfigRepository: ISmtpConfigRepository;
  aesKey: string;
}

export function getUpdateSmtpConfigFunction() {
  const inngest = getInngestClient();

  return inngest.createFunction(
    {
      id: "update-smtp-config",
      triggers: [{ event: "app/update-smtp-config" }],
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async ({ event, step, logger, ...ctx }: any) => {
      const { smtpConfigRepository, aesKey } = ctx as FunctionContext;
      const { id, userId, updates } = event.data;

      await step.run("verify-ownership", async () => {
        const record = await smtpConfigRepository.findById(id);
        if (!record) {
          throw new AppError(404, "SMTP config not found");
        }
        if (record.userId !== userId) {
          throw new AppError(403, "Not authorized to update this SMTP config");
        }
      });

      const result = await step.run("encrypt-and-update-smtp-config", async () => {
        logger.info({ smtpConfigId: id }, "Updating SMTP config");

        const encryptedUpdates: Record<string, string> = {};

        if (updates.smtpHostname) {
          encryptedUpdates.smtpHostname = await encrypt(updates.smtpHostname, aesKey);
        }
        if (updates.smtpUsername) {
          encryptedUpdates.smtpUsername = await encrypt(updates.smtpUsername, aesKey);
        }
        if (updates.smtpPassword) {
          encryptedUpdates.smtpPassword = await encrypt(updates.smtpPassword, aesKey);
        }
        if (updates.senderEmail) {
          encryptedUpdates.senderEmail = await encrypt(updates.senderEmail, aesKey);
        }
        if (updates.isActive !== undefined) {
          encryptedUpdates.isActive = updates.isActive;
        }

        const record = await smtpConfigRepository.update(id, encryptedUpdates);
        logger.info({ smtpConfigId: id }, "SMTP config updated");
        return record;
      });

      return result;
    },
  );
}
