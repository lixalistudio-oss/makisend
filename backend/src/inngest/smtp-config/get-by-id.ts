import { AppError } from "@/core/errors";
import { getInngestClient } from "../client";
import type { ISmtpConfigRepository } from "@/smtp-config/smtp-config.types";

interface FunctionContext {
  smtpConfigRepository: ISmtpConfigRepository;
}

export function getGetSmtpConfigByIdFunction() {
  const inngest = getInngestClient();

  return inngest.createFunction(
    {
      id: "get-smtp-config-by-id",
      triggers: [{ event: "app/get-smtp-config-by-id" }],
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async ({ event, step, ...ctx }: any) => {
      const { smtpConfigRepository } = ctx as FunctionContext;
      const { id, userId } = event.data;

      const result = await step.run("fetch-smtp-config-by-id", async () => {
        const record = await smtpConfigRepository.findById(id);
        if (!record) {
          throw new AppError(404, "SMTP config not found");
        }
        if (record.userId !== userId) {
          throw new AppError(403, "Not authorized to access this SMTP config");
        }
        return record;
      });

      return result;
    },
  );
}
