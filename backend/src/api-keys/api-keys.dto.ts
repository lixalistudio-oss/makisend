import { z } from "zod";
import { MAX_ID_LENGTH, MAX_NAME_LENGTH } from "@/core/validation";

export const CreateApiKeyDto = z
  .object({
    smtpConfigId: z
      .string()
      .min(1, { message: "SMTP config ID is required." })
      .max(MAX_ID_LENGTH, {
        message: `SMTP config ID must be at most ${MAX_ID_LENGTH} characters.`,
      }),
    name: z
      .string()
      .trim()
      .min(1, { message: "Name cannot be empty." })
      .max(MAX_NAME_LENGTH, {
        message: `Name must be at most ${MAX_NAME_LENGTH} characters.`,
      })
      .optional(),
  })
  .strict();

export type CreateApiKeyDto = z.infer<typeof CreateApiKeyDto>;
