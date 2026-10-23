import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { pinoLogger } from "@/core/logger";
import type { Bindings, UserInfoVariables } from "@/index";
import type { EmailLogService } from "./email-logs.service";
import type { EmailLogPageFilters } from "./email-logs.types";
import { MAX_PAGE_SIZE } from "./email-logs.repository";
import { MAX_EMAIL_LENGTH, MAX_ID_LENGTH } from "@/core/validation";

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
    const limit = c.req.query("limit");
    const cursor = c.req.query("cursor");

    const filters: EmailLogPageFilters = {};
    if (smtpConfigId) {
      const parsed = z.string().min(1).max(MAX_ID_LENGTH).safeParse(smtpConfigId);
      if (parsed.success) filters.smtpConfigId = parsed.data;
    }
    if (to) {
      const parsed = z.string().min(1).max(MAX_EMAIL_LENGTH).safeParse(to);
      if (parsed.success) filters.to = parsed.data;
    }
    if (status) {
      const parsed = z.enum(["received", "processing", "cleaned", "sent", "failed"]).safeParse(status);
      if (parsed.success) filters.status = parsed.data;
    }
    if (limit) {
      const parsed = z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).safeParse(limit);
      if (parsed.success) filters.limit = parsed.data;
    }
    if (cursor) {
      const parsed = z.string().min(1).max(512).safeParse(cursor);
      if (parsed.success) filters.cursor = parsed.data;
    }

    pinoLogger.info({ userId, filters }, "GET /email-logs - querying with filters");
    const { logs, nextCursor } = await service.findPageByUser(userId, filters);
    pinoLogger.info({ userId, count: logs.length, hasMore: nextCursor !== null }, "GET /email-logs - returning logs");
    return c.json({ logs, nextCursor }, 200);
  });

  controller.get(
    "/:id",
    zValidator("param", z.object({ id: z.string().min(1).max(MAX_ID_LENGTH) })),
    async (c) => {
      const userId = c.get("userId");
      const id = c.req.valid("param").id;
      pinoLogger.info({ userId, id }, "GET /email-logs/:id - fetching log");
      const service = getService();

      const log = await service.findById(id, userId);
      pinoLogger.info({ userId, id }, "GET /email-logs/:id - log found");
      return c.json({ log }, 200);
    },
  );

  return controller;
}
