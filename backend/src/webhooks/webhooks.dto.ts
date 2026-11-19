import { z } from "zod";
import {
  MAX_WEBHOOK_URL_LENGTH,
  WEBHOOK_DELIVERIES_DEFAULT_LIMIT,
  WEBHOOK_DELIVERIES_MAX_LIMIT,
  WEBHOOK_DELIVERY_STATUSES,
} from "./webhooks.constants";

/**
 * Shape checks only. The URL rules (https, no private address…) need the deployment's
 * options and live in webhook-url.ts, applied by the service: they answer 400 WEBHOOK_URL_INVALID.
 */
const webhookUrl = z
  .string({ message: "The URL is required." })
  .trim()
  .min(1, { message: "The URL is required." })
  .max(MAX_WEBHOOK_URL_LENGTH, { message: `Webhook URLs must be at most ${MAX_WEBHOOK_URL_LENGTH} characters.` });

export const CreateWebhookEndpointDto = z.object({ url: webhookUrl }).strict();
export type CreateWebhookEndpointDto = z.infer<typeof CreateWebhookEndpointDto>;

/** `.strict()` refuses `secret`: it only changes through POST /webhooks/:id/rotate-secret. */
export const UpdateWebhookEndpointDto = z
  .object({
    url: webhookUrl.optional(),
    enabled: z.boolean({ message: "enabled must be true or false." }).optional(),
  })
  .strict()
  .refine((dto) => dto.url !== undefined || dto.enabled !== undefined, {
    message: "Provide at least one of url or enabled.",
  });
export type UpdateWebhookEndpointDto = z.infer<typeof UpdateWebhookEndpointDto>;

export const RotateWebhookSecretDto = z
  .object({ expireCurrentNow: z.boolean({ message: "expireCurrentNow must be true or false." }).optional() })
  .strict();
export type RotateWebhookSecretDto = z.infer<typeof RotateWebhookSecretDto>;

export const ListWebhookDeliveriesQueryDto = z
  .object({
    status: z.enum(WEBHOOK_DELIVERY_STATUSES).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(WEBHOOK_DELIVERIES_MAX_LIMIT)
      .default(WEBHOOK_DELIVERIES_DEFAULT_LIMIT),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();
export type ListWebhookDeliveriesQueryDto = z.infer<typeof ListWebhookDeliveriesQueryDto>;
