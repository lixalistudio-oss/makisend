import { Hono } from "hono";
import { z } from "zod";
import { pinoLogger } from "@/core/logger";
import type { Bindings, UserInfoVariables } from "@/index";
import type { EmailLogService } from "./email-logs.service";
import type { EmailLogFilters } from "./email-logs.types";

export function createEmailLogsController(
  getService: () => EmailLogService,
): Hono<{ Bindings: Bindings; Variables: UserInfoVariables }> {
  const controller = new Hono<{ Bindings: Bindings; Variables: UserInfoVariables }>();

  controller.get("", async (c) => {
    const userId = c.get("userId");
    pinoLogger.info({ userId }, "GET /email-logs - listing logs");
    const service = getService();

    const smtpConfigId = c.req.query("smtpConfigId");
    const to = c.req.query("to");
    const status = c.req.query("status");

    const filters: EmailLogFilters = {};
    if (smtpConfigId) {
      const parsed = z.string().min(1).safeParse(smtpConfigId);
      if (parsed.success) filters.smtpConfigId = parsed.data;
    }
    if (to) {
      const parsed = z.string().min(1).safeParse(to);
      if (parsed.success) filters.to = parsed.data;
    }
    if (status) {
      const parsed = z.enum(["received", "processing", "cleaned", "sent", "failed"]).safeParse(status);
      if (parsed.success) filters.status = parsed.data;
    }

    pinoLogger.info({ userId, filters }, "GET /email-logs - querying with filters");
    const logs = await service.findAllByUser(userId, filters);
    pinoLogger.info({ userId, count: logs.length }, "GET /email-logs - returning logs");
    return c.json({ logs }, 200);
  });

  controller.get(
    "/:id",
    async (c) => {
      const userId = c.get("userId");
      const id = c.req.param("id");
      pinoLogger.info({ userId, id }, "GET /email-logs/:id - fetching log");
      const service = getService();

      const log = await service.findById(id, userId);
      pinoLogger.info({ userId, id }, "GET /email-logs/:id - log found");
      return c.json({ log }, 200);
    },
  );

  return controller;
}
