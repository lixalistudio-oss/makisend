import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { pinoLogger } from "@/core/logger";
import { MAX_ID_LENGTH } from "@/core/validation";
import type { Bindings, UserInfoVariables } from "@/index";
import { AddSuppressionDto } from "./suppressions.dto";
import type { SuppressionService } from "./suppressions.service";

export const MANUAL_SUPPRESSION_REASON = "Added from the dashboard";

export function createSuppressionsController(
  getService: () => SuppressionService,
): Hono<{ Bindings: Bindings; Variables: UserInfoVariables }> {
  const controller = new Hono<{ Bindings: Bindings; Variables: UserInfoVariables }>();

  controller.get("", async (c) => {
    const userId = c.get("userId");
    const suppressions = await getService().list(userId);
    return c.json({ suppressions }, 200);
  });

  controller.post(
    "",
    zValidator("json", AddSuppressionDto, (result, c) => {
      if (!result.success) {
        const errors = z.flattenError(result.error);
        return c.json(
          {
            error: "Validation failed",
            details: {
              fieldErrors: errors.fieldErrors,
              formErrors: errors.formErrors,
            },
          },
          400,
        );
      }
    }),
    async (c) => {
      const userId = c.get("userId");
      const { email, reason } = c.req.valid("json");
      const created = await getService().add(userId, email, {
        source: "manual",
        reason: reason ?? MANUAL_SUPPRESSION_REASON,
      });
      pinoLogger.info({ userId, created }, "POST /suppressions");
      return c.json({ success: true, created }, created ? 201 : 200);
    },
  );

  controller.delete(
    "/:id",
    zValidator("param", z.object({ id: z.string().min(1).max(MAX_ID_LENGTH) })),
    async (c) => {
      const userId = c.get("userId");
      const { id } = c.req.valid("param");
      await getService().remove(id, userId);
      pinoLogger.info({ userId, id }, "DELETE /suppressions/:id");
      return c.json({ success: true }, 200);
    },
  );

  return controller;
}
