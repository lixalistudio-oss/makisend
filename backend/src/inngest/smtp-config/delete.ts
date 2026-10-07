import { AppError } from "@/core/errors";
import { getInngestClient } from "../client";
import type { ISmtpConfigRepository } from "@/smtp-config/smtp-config.types";

interface FunctionContext {
  smtpConfigRepository: ISmtpConfigRepository;
}

export function getDeleteSmtpConfigFunction() {
  const inngest = getInngestClient();

  return inngest.createFunction(
    {
      id: "delete-smtp-config",
      triggers: [{ event: "app/delete-smtp-config" }],
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async ({ event, step, logger, ...ctx }: any) => {
      const { smtpConfigRepository } = ctx as FunctionContext;
      const { id, userId } = event.data;

      await step.run("verify-ownership-and-delete", async () => {
        const record = await smtpConfigRepository.findById(id);
        if (!record) {
          throw new AppError(404, "SMTP config not found");
        }
        if (record.userId !== userId) {
          throw new AppError(403, "Not authorized to delete this SMTP config");
        }

        logger.info({ smtpConfigId: id }, "Deleting SMTP config");
        await smtpConfigRepository.delete(id);
        logger.info({ smtpConfigId: id }, "SMTP config deleted");
      });

      return { success: true };
    },
  );
}
