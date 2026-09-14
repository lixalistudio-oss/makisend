import { z } from "zod";

export const CreateApiKeyDto = z
  .object({
    smtpConfigId: z
      .string()
      .min(1, { message: "SMTP config ID is required." }),
    name: z
      .string()
      .trim()
      .min(1, { message: "Name cannot be empty." })
      .optional(),
  })
  .strict();

export type CreateApiKeyDto = z.infer<typeof CreateApiKeyDto>;
