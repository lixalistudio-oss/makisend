import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { pinoLogger } from "@/core/logger";
import type { Bindings, UserInfoVariables } from "@/index";
import { DashboardQueryDto, StatsQueryDto, RecentQueryDto, ErrorsQueryDto } from "./dashboard.dto";
import type { DashboardService } from "./dashboard.service";

export function createDashboardController(
  getService: () => DashboardService,
): Hono<{ Bindings: Bindings; Variables: UserInfoVariables }> {
  const controller = new Hono<{ Bindings: Bindings; Variables: UserInfoVariables }>();

  controller.get(
    "/stats",
    zValidator("query", StatsQueryDto, (result, c) => {
      if (!result.success) {
        const errors = z.flattenError(result.error);
        pinoLogger.error({ errors }, "GET /dashboard/stats - validation failed");
        return c.json({ error: "Invalid query parameters" }, 400);
      }
    }),
    async (c) => {
      const userId = c.get("userId");
      const { days, apiKeyId } = c.req.valid("query");
      pinoLogger.info({ userId, days, apiKeyId }, "GET /dashboard/stats");
      const service = getService();
      const stats = await service.getStats(userId, days, apiKeyId);
      pinoLogger.info({ userId, stats }, "GET /dashboard/stats - success");
      return c.json({ stats }, 200);
    },
  );

  controller.get(
    "/by-config",
    zValidator("query", DashboardQueryDto, (result, c) => {
      if (!result.success) {
        const errors = z.flattenError(result.error);
        pinoLogger.error({ errors }, "GET /dashboard/by-config - validation failed");
        return c.json({ error: "Invalid query parameters" }, 400);
      }
    }),
    async (c) => {
      const userId = c.get("userId");
      const { days } = c.req.valid("query");
      pinoLogger.info({ userId, days }, "GET /dashboard/by-config");
      const service = getService();
      const breakdown = await service.getByConfig(userId, days);
      pinoLogger.info({ userId, count: breakdown.length }, "GET /dashboard/by-config - success");
      return c.json({ breakdown }, 200);
    },
  );

  controller.get(
    "/by-api-key",
    zValidator("query", DashboardQueryDto, (result, c) => {
      if (!result.success) {
        const errors = z.flattenError(result.error);
        pinoLogger.error({ errors }, "GET /dashboard/by-api-key - validation failed");
        return c.json({ error: "Invalid query parameters" }, 400);
      }
    }),
    async (c) => {
      const userId = c.get("userId");
      const { days } = c.req.valid("query");
      pinoLogger.info({ userId, days }, "GET /dashboard/by-api-key");
      const service = getService();
      const breakdown = await service.getByApiKey(userId, days);
      pinoLogger.info({ userId, count: breakdown.length }, "GET /dashboard/by-api-key - success");
      return c.json({ breakdown }, 200);
    },
  );

  controller.get(
    "/recent",
    zValidator("query", RecentQueryDto, (result, c) => {
      if (!result.success) {
        const errors = z.flattenError(result.error);
        pinoLogger.error({ errors }, "GET /dashboard/recent - validation failed");
        return c.json({ error: "Invalid query parameters" }, 400);
      }
    }),
    async (c) => {
      const userId = c.get("userId");
      const { limit } = c.req.valid("query");
      pinoLogger.info({ userId, limit }, "GET /dashboard/recent");
      const service = getService();
      const recent = await service.getRecent(userId, limit);
      pinoLogger.info({ userId, count: recent.length }, "GET /dashboard/recent - success");
      return c.json({ recent }, 200);
    },
  );

  controller.get(
    "/errors",
    zValidator("query", ErrorsQueryDto, (result, c) => {
      if (!result.success) {
        const errors = z.flattenError(result.error);
        pinoLogger.error({ errors }, "GET /dashboard/errors - validation failed");
        return c.json({ error: "Invalid query parameters" }, 400);
      }
    }),
    async (c) => {
      const userId = c.get("userId");
      const { days, limit, apiKeyId } = c.req.valid("query");
      pinoLogger.info({ userId, days, limit, apiKeyId }, "GET /dashboard/errors");
      const service = getService();
      const errors = await service.getErrors(userId, days, limit, apiKeyId);
      pinoLogger.info({ userId, count: errors.length }, "GET /dashboard/errors - success");
      return c.json({ errors }, 200);
    },
  );

  return controller;
}
