import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { pinoLogger } from "@/core/logger";
import type { Bindings, UserInfoVariables } from "@/index";
import { UpdateStatusQueryDto } from "./updates.dto";
import type { UpdateService } from "./updates.service";

export function createUpdatesController(
  getService: () => UpdateService,
): Hono<{ Bindings: Bindings; Variables: UserInfoVariables }> {
  const controller = new Hono<{ Bindings: Bindings; Variables: UserInfoVariables }>();

  controller.get(
    "/status",
    zValidator("query", UpdateStatusQueryDto, (result, c) => {
      if (!result.success) {
        return c.json({ error: "Invalid query parameters" }, 400);
      }
    }),
    async (c) => {
      const { refresh } = c.req.valid("query");
      const status = await getService().getStatus({ force: refresh === "true" });
      pinoLogger.info(
        { current: status.currentVersion, latest: status.latestVersion, updateAvailable: status.updateAvailable },
        "GET /updates/status",
      );
      return c.json({ status }, 200);
    },
  );

  return controller;
}
