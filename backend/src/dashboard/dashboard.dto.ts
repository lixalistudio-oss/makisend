import { z } from "zod";

export const DashboardQueryDto = z.object({
  days: z.coerce.number().int().min(1).max(365).optional().default(7),
});

export const RecentQueryDto = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export const ErrorsQueryDto = z.object({
  days: z.coerce.number().int().min(1).max(365).optional().default(7),
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
});
