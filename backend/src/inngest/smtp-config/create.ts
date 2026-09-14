import { encrypt } from "@/core/crypto";
import { getInngestClient } from "../client";
import type { ISmtpConfigRepository } from "@/smtp-config/smtp-config.types";

interface FunctionContext {
  smtpConfigRepository: ISmtpConfigRepository;
  aesKey: string;
}

export function getCreateSmtpConfigFunction() {
  const inngest = getInngestClient();

  return inngest.createFunction(
    {
      id: "create-smtp-config",
      triggers: [{ event: "app/create-smtp-config" }],
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async ({ event, step, logger, ...ctx }: any) => {
      const { smtpConfigRepository, aesKey } = ctx as FunctionContext;
      const { userId, smtpHostname, smtpUsername, smtpPassword, senderEmail } = event.data;

      const result = await step.run("encrypt-and-create-smtp-config", async () => {
        logger.info({ userId }, "Creating SMTP config");

        const [encryptedHostname, encryptedUsername, encryptedPassword, encryptedSenderEmail] =
          await Promise.all([
            encrypt(smtpHostname, aesKey),
            encrypt(smtpUsername, aesKey),
            encrypt(smtpPassword, aesKey),
            encrypt(senderEmail, aesKey),
          ]);

        const record = await smtpConfigRepository.create(userId, {
          smtpHostname: encryptedHostname,
          smtpUsername: encryptedUsername,
          smtpPassword: encryptedPassword,
          senderEmail: encryptedSenderEmail,
        });

        logger.info({ smtpConfigId: record.id }, "SMTP config created");
        return record;
      });

      return result;
    },
  );
}
