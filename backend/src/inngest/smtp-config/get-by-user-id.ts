import { getInngestClient } from "../client";
import type { ISmtpConfigRepository } from "@/smtp-config/smtp-config.types";

interface FunctionContext {
  smtpConfigRepository: ISmtpConfigRepository;
}

export function getGetSmtpConfigsByUserIdFunction() {
  const inngest = getInngestClient();

  return inngest.createFunction(
    {
      id: "get-smtp-configs-by-user-id",
      triggers: [{ event: "app/get-smtp-configs-by-user-id" }],
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async ({ event, step, ...ctx }: any) => {
      const { smtpConfigRepository } = ctx as FunctionContext;
      const { userId } = event.data;

      const result = await step.run("fetch-smtp-configs-by-user-id", async () => {
        return smtpConfigRepository.findByUserId(userId);
      });

      return result;
    },
  );
}
