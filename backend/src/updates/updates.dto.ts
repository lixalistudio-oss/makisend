import { z } from "zod";

/** `GET /updates/status?refresh=true` asks for a fresh check ("Check now"). */
export const UpdateStatusQueryDto = z
  .object({
    refresh: z.enum(["true", "false"]).optional(),
  })
  .strict();

export type UpdateStatusQuery = z.infer<typeof UpdateStatusQueryDto>;
