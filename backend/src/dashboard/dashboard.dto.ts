import { z } from "zod";

export const DashboardQueryDto = z.object({
  days: z.coerce.number().int().min(1).max(365).optional().default(7),
});

// Optional narrowing to one API key. The user scope is always applied as well, so an
// id that belongs to someone else simply matches nothing.
const ApiKeyIdDto = z.string().min(1).max(128).optional();

export const StatsQueryDto = DashboardQueryDto.extend({ apiKeyId: ApiKeyIdDto });

export const RecentQueryDto = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export const ErrorsQueryDto = z.object({
  days: z.coerce.number().int().min(1).max(365).optional().default(7),
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
  apiKeyId: ApiKeyIdDto,
});
