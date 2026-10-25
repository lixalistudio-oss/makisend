import { z } from "zod";
import { hasLineBreak, MAX_EMAIL_LENGTH } from "@/core/validation";

export const MAX_SUPPRESSION_REASON_LENGTH = 200;

export const AddSuppressionDto = z
  .object({
    email: z
      .email({ message: "Please provide a valid email address." })
      .trim()
      .max(MAX_EMAIL_LENGTH, { message: `Email must be at most ${MAX_EMAIL_LENGTH} characters.` }),
    reason: z
      .string()
      .trim()
      .min(1, { message: "Reason cannot be empty." })
      .max(MAX_SUPPRESSION_REASON_LENGTH, {
        message: `Reason must be at most ${MAX_SUPPRESSION_REASON_LENGTH} characters.`,
      })
      .refine((value) => !hasLineBreak(value), { message: "Reason must not contain line breaks." })
      .optional(),
  })
  .strict();

export type AddSuppressionDto = z.infer<typeof AddSuppressionDto>;
