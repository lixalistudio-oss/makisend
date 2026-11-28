import { z } from "zod";
import { CreateApiKeyDto } from "@/api-keys/api-keys.dto";
import { SendEmailPayloadDto } from "@/send-email/send-email.dto";
import {
  CreateSmtpConfigDto,
  TestSendDto,
  UpdateSmtpConfigDto,
} from "@/smtp-config/smtp-config.dto";
import { SMTP_PORTS } from "@/smtp-config/smtp-host";
import {
  CreateTemplateDto,
  PreviewTemplateDto,
  UpdateTemplateDto,
} from "@/templates/templates.dto";
import {
  CreateWebhookEndpointDto,
  RotateWebhookSecretDto,
  UpdateWebhookEndpointDto,
} from "@/webhooks/webhooks.dto";
import {
  MAX_WEBHOOK_ENDPOINTS,
  WEBHOOK_AUTO_DISABLE_THRESHOLD,
  WEBHOOK_DELIVERIES_DEFAULT_LIMIT,
  WEBHOOK_DELIVERIES_MAX_LIMIT,
  WEBHOOK_DELIVERY_STATUSES,
  WEBHOOK_DISABLED_REASONS,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_FAILURE_KINDS,
  WEBHOOK_HISTORY_MAX_ENTRIES,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_TEST_RATE_LIMIT,
} from "@/webhooks/webhooks.constants";

const schemaRef = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const responseRef = (name: string) => ({ $ref: `#/components/responses/${name}` });

type ZodSchema = z.ZodTypeAny;

type JsonSchemaObject = {
  type?: string;
  properties?: Record<string, Record<string, unknown>>;
  required?: string[];
  anyOf?: JsonSchemaObject[];
  [key: string]: unknown;
};

/**
 * DTOs stay the single source of truth for request validation. Zod emits
 * JSON Schema 2020-12, which OpenAPI 3.1 embeds directly.
 */
function inputSchema(schema: ZodSchema, description: string): JsonSchemaObject {
  const generated = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io: "input",
  }) as JsonSchemaObject;
  delete generated.$schema;
  return { ...generated, description };
}

const idParameter = {
  name: "id",
  in: "path",
  required: true,
  description: "Resource identifier.",
  schema: { type: "string", minLength: 1, maxLength: 128 },
} as const;

const idempotencyKeyParameter = {
  name: "Idempotency-Key",
  in: "header",
  required: false,
  description:
    "Optional unique key for safe retries. Replaying the same key and body returns the stored response for 24 hours; reusing it with a different body returns 409.",
  schema: { type: "string", minLength: 1, maxLength: 255 },
} as const;

const sessionSecurity = [{ SessionCookie: [] }];
const apiKeySecurity = [{ ApiKey: [] }, { Bearer: [] }];

const sessionErrors = {
  401: responseRef("Unauthorized"),
  403: responseRef("Forbidden"),
  500: responseRef("ServerError"),
};

const jsonResponse = (description: string, schemaName: string) => ({
  description,
  content: {
    "application/json": {
      schema: schemaRef(schemaName),
    },
  },
});

function patchProperty(
  schema: JsonSchemaObject,
  name: string,
  patch: Record<string, unknown>,
): void {
  const property = schema.properties?.[name];
  if (property) Object.assign(property, patch);
}

const createSmtpConfigSchema = inputSchema(
  CreateSmtpConfigDto,
  "SMTP credentials to create or test. The password is encrypted at rest and never returned. A host on `smtp.mx.cloudflare.net` is delivered through the Cloudflare Email Service binding instead of a socket.",
);
patchProperty(createSmtpConfigSchema, "smtpHostname", {
  description:
    "Provider hostname without a scheme, port, or path. `smtp.mx.cloudflare.net` uses the Cloudflare Email Service binding.",
});
patchProperty(createSmtpConfigSchema, "smtpPort", {
  enum: [...SMTP_PORTS],
  description:
    "Submission port. Port 25 is blocked outbound on Cloudflare Workers.",
});
patchProperty(createSmtpConfigSchema, "smtpSecurity", {
  description:
    "Defaults to `tls` on 465/2465 and `starttls` on the other allowed ports.",
});
patchProperty(createSmtpConfigSchema, "smtpPassword", {
  writeOnly: true,
  description: "Stored encrypted; never included in responses.",
});

const updateSmtpConfigSchema = inputSchema(
  UpdateSmtpConfigDto,
  "Partial SMTP configuration update.",
);
patchProperty(updateSmtpConfigSchema, "smtpHostname", {
  description: "Provider hostname without a scheme, port, or path.",
});
patchProperty(updateSmtpConfigSchema, "smtpPort", {
  enum: [...SMTP_PORTS],
  description:
    "Changing the port without `smtpSecurity` re-derives that port's usual security mode.",
});
patchProperty(updateSmtpConfigSchema, "smtpPassword", {
  writeOnly: true,
  description: "Stored encrypted; omit to keep the current password.",
});

const testSendSchema = inputSchema(TestSendDto, "Test email recipient and optional content.");
patchProperty(testSendSchema, "to", { format: "email", maxLength: 320 });

const sendEmailPayloadSchema = inputSchema(
  SendEmailPayloadDto,
  "Inline email content, or a template reference. The shapes are mutually exclusive.",
);

const webhookUrlDescription =
  "Absolute `https:` URL, at most 2048 characters, without credentials, local hostnames or private, reserved or metadata IP addresses. Stored normalized (lowercase host, no `#fragment`) and encrypted. Refused rules answer `400` with code `WEBHOOK_URL_INVALID`.";

const createWebhookEndpointSchema = inputSchema(CreateWebhookEndpointDto, "Receiver URL to register.");
patchProperty(createWebhookEndpointSchema, "url", { format: "uri", description: webhookUrlDescription });

const updateWebhookEndpointSchema = inputSchema(
  UpdateWebhookEndpointDto,
  "Change the URL, or turn the endpoint off or on. At least one field is required; the secret never changes here.",
);
patchProperty(updateWebhookEndpointSchema, "url", {
  format: "uri",
  description: `${webhookUrlDescription} The secret stays the same.`,
});
patchProperty(updateWebhookEndpointSchema, "enabled", {
  description:
    "`false` stops new deliveries (`disabledReason: \"manual\"`); pending ones are skipped. `true` clears `disabledReason` and the failure counter.",
});

const rotateWebhookSecretSchema = inputSchema(RotateWebhookSecretDto, "Optional rotation options.");
patchProperty(rotateWebhookSecretSchema, "expireCurrentNow", {
  default: false,
  description: "`true` stops the current secret at once (leaked secret). Otherwise it keeps signing for 24 hours.",
});

const webhookDeliveryIdParameter = {
  name: "deliveryId",
  in: "path",
  required: true,
  description: "Delivery identifier.",
  schema: { type: "string", minLength: 1, maxLength: 128 },
} as const;

const webhookError = (description: string) => jsonResponse(description, "Error");

/** Headers of every outgoing webhook request (Standard Webhooks). */
const webhookRequestHeaders = [
  {
    name: "webhook-id",
    in: "header",
    required: true,
    description: "`msg_<delivery id>`. The same for every attempt of a delivery: use it to drop duplicates.",
    schema: { type: "string" },
  },
  {
    name: "webhook-timestamp",
    in: "header",
    required: true,
    description: "Unix seconds of this attempt. Reject values older than 5 minutes.",
    schema: { type: "string" },
  },
  {
    name: "webhook-signature",
    in: "header",
    required: true,
    description:
      "`v1,<base64 HMAC-SHA256>` over `webhook-id.webhook-timestamp.raw body`, keyed with the base64-decoded secret without `whsec_`. During a rotation: two space-separated signatures, new then previous.",
    schema: { type: "string" },
  },
] as const;

/** How MakiSend reads the receiver's answer (same for every event). */
const webhookReceiverResponses = {
  "2XX": { description: "Delivered. Answer within 10 seconds, then do the slow work asynchronously." },
  "3XX": { description: "Abandoned: redirects are never followed." },
  "4XX": {
    description: "Abandoned, except 408, 409, 425 and 429, which are retried (`Retry-After` honoured up to 12 hours).",
  },
  "5XX": {
    description: `Retried, as are timeouts and network errors: ${WEBHOOK_MAX_ATTEMPTS} attempts over about 32 hours (now, +1 min, +5 min, +30 min, +2 h, +6 h, +12 h, +12 h). After ${WEBHOOK_AUTO_DISABLE_THRESHOLD} abandoned deliveries in a row the endpoint is disabled (\`disabledReason: "auto"\`).`,
  },
};

const webhookEvent = (
  operationId: string,
  summary: string,
  description: string,
  schemaName: string,
) => ({
  post: {
    tags: ["Webhooks"],
    summary,
    operationId,
    description,
    parameters: webhookRequestHeaders,
    requestBody: {
      required: true,
      content: { "application/json": { schema: schemaRef(schemaName) } },
    },
    responses: webhookReceiverResponses,
  },
});

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "MakiSend API",
    version: "0.2.0",
    summary: "Serverless transactional email API on Cloudflare Workers.",
    description: [
      "MakiSend accepts transactional emails over HTTP, stores their content encrypted in D1, and delivers them asynchronously through Cloudflare Queues, Workflows, and SMTP.",
      "",
      "**Authentication.** `POST /send-email` uses a per-tenant API key from the dashboard, sent as `x-api-key` or `Authorization: Bearer <key>`. Dashboard endpoints use the Better Auth session cookie created by `POST /api/auth/sign-in/email`; open the dashboard and sign in before trying those routes here.",
      "",
      "**Delivery is asynchronous.** `POST /send-email` returns `202 Accepted` once the email is persisted and queued. Delivery status is available through `GET /email-logs` and the dashboard endpoints.",
      "",
      "**Delivery transports.** A configuration on `smtp.mx.cloudflare.net` is sent through the Cloudflare Email Service binding; every other host uses a raw SMTP connection. `SEND_RATE_LIMIT` optionally caps sends per API key and answers `429` with `Retry-After`.",
    ].join("\n"),
    license: { name: "MIT" },
  },
  servers: [
    {
      url: "/",
      description: "Current Worker origin",
    },
  ],
  tags: [
    { name: "Emails", description: "Queue transactional emails for delivery." },
    { name: "SMTP Config", description: "Manage encrypted SMTP or Cloudflare Email Service credentials." },
    { name: "API Keys", description: "Manage per-configuration API keys." },
    { name: "Email Logs", description: "Inspect delivery logs and history." },
    { name: "Dashboard", description: "Aggregated delivery metrics." },
    { name: "Templates", description: "Reusable email templates with variables." },
    {
      name: "Webhooks",
      description:
        "Signed webhooks of each email's final status (`email.sent`, `email.failed`), Standard Webhooks format. The routes manage the receiving endpoints; the requests MakiSend sends are under `webhooks`.",
    },
    { name: "Updates", description: "Whether a newer MakiSend release is published." },
    { name: "Meta", description: "API documentation and schema discovery." },
  ],
  paths: {
    "/send-email": {
      post: {
        tags: ["Emails"],
        summary: "Queue a transactional email",
        operationId: "sendEmail",
        description:
          "Accepts either inline content (`subject`, `text`, `html`) or a `templateId` plus `variables`. The two shapes are mutually exclusive. Both accept optional `attachments`. HTML is sanitized before delivery. Send the optional `Idempotency-Key` header to make retries safe.",
        security: apiKeySecurity,
        parameters: [idempotencyKeyParameter],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: schemaRef("SendEmailPayload"),
            },
          },
        },
        responses: {
          202: {
            description: "Email persisted and queued for asynchronous delivery.",
            headers: {
              "Idempotency-Replayed": {
                description:
                  "`true` when this response was replayed from a previous request with the same idempotency key.",
                schema: { type: "string", enum: ["true", "false"] },
              },
              "RateLimit-Limit": {
                description:
                  "Only when `SEND_RATE_LIMIT` is set: the send quota for this API key.",
                schema: { type: "integer" },
              },
              "RateLimit-Remaining": {
                description:
                  "Only when `SEND_RATE_LIMIT` is set: sends left in the current quota window.",
                schema: { type: "integer" },
              },
            },
            content: {
              "application/json": {
                schema: schemaRef("SendEmailAccepted"),
              },
            },
          },
          400: responseRef("ValidationError"),
          401: responseRef("Unauthorized"),
          403: responseRef("Forbidden"),
          404: {
            description: "The referenced template does not exist for this account.",
            content: {
              "application/json": {
                schema: schemaRef("Error"),
              },
            },
          },
          409: responseRef("Conflict"),
          429: {
            description:
              "Only when the instance sets `SEND_RATE_LIMIT`: this API key reached its send quota. `Retry-After` gives the seconds until the window restarts.",
            headers: {
              "Retry-After": { description: "Seconds until the quota window restarts.", schema: { type: "integer" } },
            },
            content: { "application/json": { schema: schemaRef("Error") } },
          },
          500: responseRef("ServerError"),
        },
      },
    },
    "/smtp-config": {
      get: {
        tags: ["SMTP Config"],
        summary: "List SMTP configurations",
        operationId: "listSmtpConfigs",
        security: sessionSecurity,
        responses: {
          200: jsonResponse("SMTP configurations owned by the session user.", "SmtpConfigList"),
          ...sessionErrors,
        },
      },
      post: {
        tags: ["SMTP Config"],
        summary: "Create an SMTP configuration",
        operationId: "createSmtpConfig",
        description:
          "Hostname, username, password, and sender address are encrypted at rest. Allowed ports are 465, 587, 2465, 2525, and 2587; port 25 is blocked on Workers. When `smtpSecurity` is omitted it defaults to `tls` on 465/2465 and `starttls` otherwise. A host on `smtp.mx.cloudflare.net` uses the Cloudflare Email Service binding instead of SMTP.",
        security: sessionSecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: schemaRef("CreateSmtpConfig"),
            },
          },
        },
        responses: {
          201: jsonResponse("SMTP configuration created.", "SmtpConfigEnvelope"),
          400: responseRef("ValidationError"),
          ...sessionErrors,
        },
      },
    },
    "/smtp-config/check": {
      post: {
        tags: ["SMTP Config"],
        summary: "Check credentials before saving",
        operationId: "checkUnsavedSmtpConfig",
        description:
          "Opens an SMTP connection with the submitted credentials without persisting them. Works for inactive configurations too. A host on `smtp.mx.cloudflare.net` is checked through the Cloudflare Email Service binding.",
        security: sessionSecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: schemaRef("CreateSmtpConfig"),
            },
          },
        },
        responses: {
          200: jsonResponse(
            "Connection succeeded or failed; the result is always HTTP 200.",
            "SmtpCheckResult",
          ),
          400: responseRef("ValidationError"),
          ...sessionErrors,
        },
      },
    },
    "/smtp-config/{id}": {
      get: {
        tags: ["SMTP Config"],
        summary: "Get an SMTP configuration",
        operationId: "getSmtpConfig",
        security: sessionSecurity,
        parameters: [idParameter],
        responses: {
          200: jsonResponse("SMTP configuration.", "SmtpConfigEnvelope"),
          ...sessionErrors,
          404: responseRef("NotFound"),
        },
      },
      put: {
        tags: ["SMTP Config"],
        summary: "Update an SMTP configuration",
        operationId: "updateSmtpConfig",
        description:
          "Only supplied fields change. Supplying `smtpPort` without `smtpSecurity` re-derives the usual security mode for that port.",
        security: sessionSecurity,
        parameters: [idParameter],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: schemaRef("UpdateSmtpConfig"),
            },
          },
        },
        responses: {
          200: jsonResponse("SMTP configuration updated.", "SmtpConfigEnvelope"),
          400: responseRef("ValidationError"),
          ...sessionErrors,
          404: responseRef("NotFound"),
        },
      },
      delete: {
        tags: ["SMTP Config"],
        summary: "Delete an SMTP configuration",
        operationId: "deleteSmtpConfig",
        description: "Also deletes the API key bound to this configuration and its logs.",
        security: sessionSecurity,
        parameters: [idParameter],
        responses: {
          200: jsonResponse("SMTP configuration deleted.", "SuccessResponse"),
          ...sessionErrors,
          404: responseRef("NotFound"),
        },
      },
    },
    "/smtp-config/{id}/check": {
      post: {
        tags: ["SMTP Config"],
        summary: "Check a saved SMTP configuration",
        operationId: "checkSmtpConfig",
        security: sessionSecurity,
        parameters: [idParameter],
        responses: {
          200: jsonResponse(
            "Connection succeeded or failed; the result is always HTTP 200.",
            "SmtpCheckResult",
          ),
          ...sessionErrors,
          404: responseRef("NotFound"),
        },
      },
    },
    "/smtp-config/{id}/test-send": {
      post: {
        tags: ["SMTP Config"],
        summary: "Send a test email",
        operationId: "sendSmtpTestEmail",
        description:
          "Sends a one-off message through the saved configuration. It is recorded in the email logs with `source: \"test\"` and this configuration's id, and never counted in the dashboard totals. A host on `smtp.mx.cloudflare.net` is sent through the Cloudflare Email Service binding.",
        security: sessionSecurity,
        parameters: [idParameter],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: schemaRef("TestSend"),
            },
          },
        },
        responses: {
          200: jsonResponse(
            "Send succeeded or failed; the result is always HTTP 200.",
            "SmtpSendResult",
          ),
          400: responseRef("ValidationError"),
          ...sessionErrors,
          404: responseRef("NotFound"),
        },
      },
    },
    "/api-keys": {
      get: {
        tags: ["API Keys"],
        summary: "List API keys",
        operationId: "listApiKeys",
        security: sessionSecurity,
        responses: {
          200: jsonResponse("API keys owned by the session user.", "ApiKeyList"),
          ...sessionErrors,
        },
      },
      post: {
        tags: ["API Keys"],
        summary: "Create an API key",
        operationId: "createApiKey",
        description:
          "Several API keys can share one SMTP configuration. The plaintext key is returned only in this response.",
        security: sessionSecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: schemaRef("CreateApiKey"),
            },
          },
        },
        responses: {
          201: jsonResponse("API key created.", "ApiKeyCreated"),
          400: responseRef("ValidationError"),
          ...sessionErrors,
        },
      },
    },
    "/api-keys/{id}": {
      delete: {
        tags: ["API Keys"],
        summary: "Revoke an API key",
        operationId: "deleteApiKey",
        security: sessionSecurity,
        parameters: [idParameter],
        responses: {
          200: jsonResponse("API key revoked.", "SuccessResponse"),
          ...sessionErrors,
          404: responseRef("NotFound"),
        },
      },
    },
    "/email-logs": {
      get: {
        tags: ["Email Logs"],
        summary: "List email logs",
        operationId: "listEmailLogs",
        description:
          "Newest first, cursor-paginated. The recipient filter is applied to the decrypted current page, so a page can contain fewer rows than `limit` when filtering by `to`.",
        security: sessionSecurity,
        parameters: [
          {
            name: "smtpConfigId",
            in: "query",
            description: "The emails sent with this configuration's keys, plus its test sends.",
            schema: { type: "string", maxLength: 128 },
          },
          {
            name: "apiKeyId",
            in: "query",
            description: "Only the emails sent with this API key.",
            schema: { type: "string", maxLength: 128 },
          },
          {
            name: "to",
            in: "query",
            description: "Case-insensitive substring match on the decrypted recipient.",
            schema: { type: "string", maxLength: 320 },
          },
          {
            name: "status",
            in: "query",
            schema: {
              type: "string",
              enum: ["received", "processing", "cleaned", "sent", "failed"],
            },
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
          },
          {
            name: "cursor",
            in: "query",
            description: "Opaque `nextCursor` from the previous page.",
            schema: { type: "string", maxLength: 512 },
          },
        ],
        responses: {
          200: jsonResponse("Page of email logs with their history.", "EmailLogPage"),
          ...sessionErrors,
        },
      },
    },
    "/email-logs/{id}": {
      get: {
        tags: ["Email Logs"],
        summary: "Get an email log",
        operationId: "getEmailLog",
        security: sessionSecurity,
        parameters: [idParameter],
        responses: {
          200: jsonResponse("Email log with its full history.", "EmailLogEnvelope"),
          ...sessionErrors,
          404: responseRef("NotFound"),
        },
      },
    },
    "/dashboard/stats": {
      get: {
        tags: ["Dashboard"],
        summary: "Delivery totals",
        operationId: "getDashboardStats",
        description: "API sends only: the dashboard's test sends are never counted.",
        security: sessionSecurity,
        parameters: [
          {
            name: "days",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 365, default: 7 },
          },
          {
            name: "apiKeyId",
            in: "query",
            description: "Only the emails sent with this API key.",
            schema: { type: "string", maxLength: 128 },
          },
        ],
        responses: {
          200: jsonResponse("Delivery statistics for the requested window.", "DashboardStatsEnvelope"),
          400: responseRef("ValidationError"),
          ...sessionErrors,
        },
      },
    },
    "/dashboard/by-config": {
      get: {
        tags: ["Dashboard"],
        summary: "Delivery totals per SMTP configuration",
        operationId: "getDashboardByConfig",
        security: sessionSecurity,
        parameters: [
          {
            name: "days",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 365, default: 7 },
          },
        ],
        responses: {
          200: jsonResponse("Per-configuration breakdown.", "SmtpBreakdownEnvelope"),
          400: responseRef("ValidationError"),
          ...sessionErrors,
        },
      },
    },
    "/dashboard/by-api-key": {
      get: {
        tags: ["Dashboard"],
        summary: "Delivery totals per API key",
        operationId: "getDashboardByApiKey",
        security: sessionSecurity,
        parameters: [
          {
            name: "days",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 365, default: 7 },
          },
        ],
        responses: {
          200: jsonResponse("Per-key breakdown, including keys that sent nothing.", "ApiKeyBreakdownEnvelope"),
          400: responseRef("ValidationError"),
          ...sessionErrors,
        },
      },
    },
    "/dashboard/recent": {
      get: {
        tags: ["Dashboard"],
        summary: "Recent emails",
        operationId: "getRecentEmails",
        security: sessionSecurity,
        parameters: [
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          },
        ],
        responses: {
          200: jsonResponse("Most recent emails.", "RecentEmailsEnvelope"),
          400: responseRef("ValidationError"),
          ...sessionErrors,
        },
      },
    },
    "/dashboard/errors": {
      get: {
        tags: ["Dashboard"],
        summary: "Most frequent delivery errors",
        operationId: "getDashboardErrors",
        security: sessionSecurity,
        parameters: [
          {
            name: "days",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 365, default: 7 },
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 50, default: 10 },
          },
          {
            name: "apiKeyId",
            in: "query",
            description: "Only the emails sent with this API key.",
            schema: { type: "string", maxLength: 128 },
          },
        ],
        responses: {
          200: jsonResponse("Aggregated failure reasons.", "ErrorSummariesEnvelope"),
          400: responseRef("ValidationError"),
          ...sessionErrors,
        },
      },
    },
    "/templates": {
      get: {
        tags: ["Templates"],
        summary: "List templates",
        operationId: "listTemplates",
        security: sessionSecurity,
        responses: {
          200: jsonResponse("Templates owned by the session user.", "TemplateList"),
          ...sessionErrors,
        },
      },
      post: {
        tags: ["Templates"],
        summary: "Create a template",
        operationId: "createTemplate",
        description:
          "Use `{{variable}}` placeholders in the subject, HTML, or text. Variables are supplied at send time.",
        security: sessionSecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: schemaRef("CreateTemplate"),
            },
          },
        },
        responses: {
          201: jsonResponse("Template created.", "TemplateEnvelope"),
          400: responseRef("ValidationError"),
          ...sessionErrors,
        },
      },
    },
    "/templates/{id}": {
      get: {
        tags: ["Templates"],
        summary: "Get a template",
        operationId: "getTemplate",
        security: sessionSecurity,
        parameters: [idParameter],
        responses: {
          200: jsonResponse("Template.", "TemplateEnvelope"),
          ...sessionErrors,
          404: responseRef("NotFound"),
        },
      },
      put: {
        tags: ["Templates"],
        summary: "Update a template",
        operationId: "updateTemplate",
        security: sessionSecurity,
        parameters: [idParameter],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: schemaRef("UpdateTemplate"),
            },
          },
        },
        responses: {
          200: jsonResponse("Template updated.", "TemplateEnvelope"),
          400: responseRef("ValidationError"),
          ...sessionErrors,
          404: responseRef("NotFound"),
        },
      },
      delete: {
        tags: ["Templates"],
        summary: "Delete a template",
        operationId: "deleteTemplate",
        security: sessionSecurity,
        parameters: [idParameter],
        responses: {
          200: jsonResponse("Template deleted.", "SuccessResponse"),
          ...sessionErrors,
          404: responseRef("NotFound"),
        },
      },
    },
    "/templates/{id}/preview": {
      post: {
        tags: ["Templates"],
        summary: "Preview a template",
        operationId: "previewTemplate",
        description:
          "Renders the saved subject, HTML, and text with the supplied variables. Missing variables, line breaks, and length limits are reported exactly as they would be by `POST /send-email`.",
        security: sessionSecurity,
        parameters: [idParameter],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: schemaRef("PreviewTemplate"),
            },
          },
        },
        responses: {
          200: jsonResponse("Rendered template preview.", "TemplatePreviewEnvelope"),
          400: responseRef("ValidationError"),
          ...sessionErrors,
          404: responseRef("NotFound"),
        },
      },
    },
    "/webhooks": {
      get: {
        tags: ["Webhooks"],
        summary: "List webhook endpoints",
        operationId: "listWebhookEndpoints",
        description: `Oldest first, URLs decrypted. At most ${MAX_WEBHOOK_ENDPOINTS} per user, so no pagination.`,
        security: sessionSecurity,
        responses: {
          200: jsonResponse("Endpoints of the session user.", "WebhookEndpointList"),
          ...sessionErrors,
        },
      },
      post: {
        tags: ["Webhooks"],
        summary: "Create a webhook endpoint",
        operationId: "createWebhookEndpoint",
        description:
          "Registers a receiver URL and generates its signing secret (`whsec_` + 32 random bytes in base64). The secret is returned **only** in this response and after a rotation: store it now.",
        security: sessionSecurity,
        requestBody: {
          required: true,
          content: { "application/json": { schema: schemaRef("CreateWebhookEndpoint") } },
        },
        responses: {
          201: jsonResponse("Endpoint created, with its secret.", "WebhookEndpointWithSecret"),
          400: webhookError("Invalid body, or URL refused (`code: WEBHOOK_URL_INVALID`, `error` says which rule)."),
          ...sessionErrors,
          409: webhookError(
            `\`WEBHOOK_LIMIT_REACHED\` (${MAX_WEBHOOK_ENDPOINTS} endpoints already) or \`WEBHOOK_URL_EXISTS\` (same normalized URL).`,
          ),
        },
      },
    },
    "/webhooks/{id}": {
      get: {
        tags: ["Webhooks"],
        summary: "Get a webhook endpoint",
        operationId: "getWebhookEndpoint",
        security: sessionSecurity,
        parameters: [idParameter],
        responses: {
          200: jsonResponse("Endpoint.", "WebhookEndpointEnvelope"),
          ...sessionErrors,
          404: webhookError("`WEBHOOK_NOT_FOUND`: unknown, or owned by another user."),
        },
      },
      put: {
        tags: ["Webhooks"],
        summary: "Update a webhook endpoint",
        operationId: "updateWebhookEndpoint",
        description:
          "Pending deliveries go to the new URL: the endpoint is read again before every attempt. Disabling it skips them.",
        security: sessionSecurity,
        parameters: [idParameter],
        requestBody: {
          required: true,
          content: { "application/json": { schema: schemaRef("UpdateWebhookEndpoint") } },
        },
        responses: {
          200: jsonResponse("Endpoint updated.", "WebhookEndpointEnvelope"),
          400: webhookError("Invalid or empty body, a `secret` field, or URL refused (`WEBHOOK_URL_INVALID`)."),
          ...sessionErrors,
          404: webhookError("`WEBHOOK_NOT_FOUND`."),
          409: webhookError("`WEBHOOK_URL_EXISTS`."),
        },
      },
      delete: {
        tags: ["Webhooks"],
        summary: "Delete a webhook endpoint",
        operationId: "deleteWebhookEndpoint",
        description: "Deletes the endpoint and its delivery log. Messages still queued for it are dropped.",
        security: sessionSecurity,
        parameters: [idParameter],
        responses: {
          204: { description: "Endpoint deleted. No body." },
          ...sessionErrors,
          404: webhookError("`WEBHOOK_NOT_FOUND`."),
        },
      },
    },
    "/webhooks/{id}/rotate-secret": {
      post: {
        tags: ["Webhooks"],
        summary: "Rotate a webhook secret",
        operationId: "rotateWebhookSecret",
        description:
          "Generates a new secret, returned once. The previous one keeps signing for 24 hours (`rotationEndsAt`): requests carry both signatures meanwhile. A second rotation within 24 hours drops the oldest secret. The body is optional.",
        security: sessionSecurity,
        parameters: [idParameter],
        requestBody: {
          required: false,
          content: { "application/json": { schema: schemaRef("RotateWebhookSecret") } },
        },
        responses: {
          200: jsonResponse("New secret.", "WebhookEndpointWithSecret"),
          400: responseRef("ValidationError"),
          ...sessionErrors,
          404: webhookError("`WEBHOOK_NOT_FOUND`."),
        },
      },
    },
    "/webhooks/{id}/test": {
      post: {
        tags: ["Webhooks"],
        summary: "Send a test event",
        operationId: "testWebhookEndpoint",
        description: `Sends a \`webhook.test\` event now, signed like a real one, without queue or retry, even to a disabled endpoint. Answers 200 when the receiver fails too: the result is the body. The receiver's body is never returned. Logged as a delivery. At most ${WEBHOOK_TEST_RATE_LIMIT} tests per minute per endpoint.`,
        security: sessionSecurity,
        parameters: [idParameter],
        responses: {
          200: jsonResponse("Result of the test request.", "WebhookTestResult"),
          400: webhookError("`WEBHOOK_URL_INVALID`: the stored URL is refused by the current rules."),
          ...sessionErrors,
          404: webhookError("`WEBHOOK_NOT_FOUND`."),
          429: {
            ...webhookError("`WEBHOOK_TEST_RATE_LIMITED`."),
            headers: {
              "Retry-After": { description: "Seconds to wait.", schema: { type: "integer" } },
            },
          },
        },
      },
    },
    "/webhooks/{id}/deliveries": {
      get: {
        tags: ["Webhooks"],
        summary: "List deliveries",
        operationId: "listWebhookDeliveries",
        description:
          "Delivery log of an endpoint, newest first. The webhook body is not stored (it is rebuilt at each attempt); see `GET /email-logs/{id}` for the email.",
        security: sessionSecurity,
        parameters: [
          idParameter,
          {
            name: "status",
            in: "query",
            description: "Only deliveries in this status.",
            schema: { type: "string", enum: [...WEBHOOK_DELIVERY_STATUSES] },
          },
          {
            name: "limit",
            in: "query",
            description: "Page size.",
            schema: {
              type: "integer",
              minimum: 1,
              maximum: WEBHOOK_DELIVERIES_MAX_LIMIT,
              default: WEBHOOK_DELIVERIES_DEFAULT_LIMIT,
            },
          },
          {
            name: "cursor",
            in: "query",
            description: "`nextCursor` of the previous page.",
            schema: { type: "string", minLength: 1, maxLength: 512 },
          },
        ],
        responses: {
          200: jsonResponse("One page of deliveries.", "WebhookDeliveryPage"),
          400: webhookError("Invalid parameter, or `WEBHOOK_CURSOR_INVALID`."),
          ...sessionErrors,
          404: webhookError("`WEBHOOK_NOT_FOUND`."),
        },
      },
    },
    "/webhooks/{id}/deliveries/{deliveryId}/retry": {
      post: {
        tags: ["Webhooks"],
        summary: "Retry a failed delivery",
        operationId: "retryWebhookDelivery",
        description: `Sets a \`failed\` delivery back to \`pending\` and queues it again. Shares the limit of the test route (${WEBHOOK_TEST_RATE_LIMIT} per minute per endpoint).`,
        security: sessionSecurity,
        parameters: [idParameter, webhookDeliveryIdParameter],
        responses: {
          202: jsonResponse("Delivery queued again.", "WebhookDeliveryEnvelope"),
          ...sessionErrors,
          404: webhookError("`WEBHOOK_NOT_FOUND` or `WEBHOOK_DELIVERY_NOT_FOUND`."),
          409: webhookError("`WEBHOOK_DELIVERY_NOT_FAILED`: the delivery is pending or delivered."),
          429: {
            ...webhookError("`WEBHOOK_TEST_RATE_LIMITED`."),
            headers: {
              "Retry-After": { description: "Seconds to wait.", schema: { type: "integer" } },
            },
          },
        },
      },
    },
    "/updates/status": {
      get: {
        tags: ["Updates"],
        summary: "New-release check",
        operationId: "getUpdateStatus",
        description:
          "Compares this build with the latest release: the latest GitHub release of the upstream repository, or, on the self-hosting Docker image (`UPDATE_SOURCE=registry`), the newest version tag of the image in its registry, with the GitHub release notes when available. Checked at most daily and cached in D1. `UPDATE_CHECK=off` turns the check off.",
        security: sessionSecurity,
        parameters: [
          {
            name: "refresh",
            in: "query",
            description: "`true` re-checks now, unless the last check is less than five minutes old.",
            schema: { type: "string", enum: ["true", "false"] },
          },
        ],
        responses: {
          200: jsonResponse("Current and latest versions.", "UpdateStatusEnvelope"),
          400: responseRef("ValidationError"),
          ...sessionErrors,
        },
      },
    },
    "/openapi.json": {
      get: {
        tags: ["Meta"],
        summary: "OpenAPI document",
        operationId: "getOpenApiDocument",
        security: [],
        responses: {
          200: {
            description: "This OpenAPI 3.1 document.",
            content: {
              "application/json": {
                schema: { type: "object" },
              },
            },
          },
        },
      },
    },
  },
  // Requests MakiSend sends to the registered endpoints (OpenAPI 3.1 `webhooks`).
  webhooks: {
    "email.sent": webhookEvent(
      "webhookEmailSent",
      "email.sent",
      "The SMTP server accepted the email. One per email and per enabled endpoint, at least once: drop duplicates with `webhook-id`. Not sent for dashboard test sends.",
      "WebhookEmailEvent",
    ),
    "email.failed": webhookEvent(
      "webhookEmailFailed",
      "email.failed",
      "MakiSend gave up on the email (permanent error, retries exhausted, invalid configuration, or the send never started). One per email and per enabled endpoint, at least once. Not sent when `POST /send-email` itself answered an error.",
      "WebhookEmailEvent",
    ),
    "webhook.test": webhookEvent(
      "webhookTest",
      "webhook.test",
      "Sent on demand by `POST /webhooks/{id}/test`, signed like the others. No retry.",
      "WebhookTestEvent",
    ),
  },
  components: {
    securitySchemes: {
      ApiKey: {
        type: "apiKey",
        in: "header",
        name: "x-api-key",
        description:
          "Per-tenant API key created in the dashboard under API Keys.",
      },
      Bearer: {
        type: "http",
        scheme: "bearer",
        description:
          "The same API key sent as `Authorization: Bearer <key>`.",
      },
      SessionCookie: {
        type: "apiKey",
        in: "cookie",
        name: "better-auth.session_token",
        description:
          "Better Auth session cookie created by `POST /api/auth/sign-in/email`. Sign in through the dashboard, then use the same browser origin for these routes.",
      },
    },
    schemas: {
      SendEmailPayload: sendEmailPayloadSchema,
      CreateSmtpConfig: createSmtpConfigSchema,
      UpdateSmtpConfig: updateSmtpConfigSchema,
      TestSend: testSendSchema,
      CreateApiKey: inputSchema(CreateApiKeyDto, "Bind a new API key to an SMTP configuration."),
      CreateTemplate: inputSchema(CreateTemplateDto, "New reusable email template."),
      UpdateTemplate: inputSchema(UpdateTemplateDto, "Partial template update."),
      PreviewTemplate: inputSchema(
        PreviewTemplateDto,
        "Variable values used to render a saved template preview.",
      ),
      SendEmailAccepted: {
        type: "object",
        required: ["success", "message", "emailId"],
        properties: {
          success: { type: "boolean", const: true },
          message: { type: "string", const: "Email queued" },
          emailId: {
            type: "string",
            description: "Internal email id used by logs and the dashboard.",
          },
        },
      },
      SmtpConfig: {
        type: "object",
        required: [
          "id",
          "userId",
          "smtpHostname",
          "smtpPort",
          "smtpSecurity",
          "smtpUsername",
          "senderEmail",
          "isActive",
          "lastCheckAt",
          "lastCheckOk",
          "lastCheckError",
          "createdAt",
          "updatedAt",
        ],
        properties: {
          id: { type: "string" },
          userId: { type: "string" },
          smtpHostname: { type: "string", description: "Decrypted SMTP hostname." },
          smtpPort: { type: "integer", enum: [...SMTP_PORTS] },
          smtpSecurity: {
            type: "string",
            enum: ["tls", "starttls"],
            description: "`tls` is implicit TLS (465/2465); `starttls` upgrades after connecting.",
          },
          smtpUsername: { type: "string", description: "Decrypted SMTP username." },
          senderEmail: { type: "string", format: "email" },
          isActive: { type: "boolean" },
          lastCheckAt: {
            type: ["string", "null"],
            format: "date-time",
            description: "Last scheduled or manual connection check.",
          },
          lastCheckOk: {
            type: ["boolean", "null"],
            description: "Result of the last check, or null before the first one.",
          },
          lastCheckError: {
            type: ["string", "null"],
            description: "Human-readable failure reason from the last check.",
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      SmtpConfigEnvelope: {
        type: "object",
        required: ["config"],
        properties: { config: schemaRef("SmtpConfig") },
      },
      SmtpConfigList: {
        type: "object",
        required: ["configs"],
        properties: {
          configs: { type: "array", items: schemaRef("SmtpConfig") },
        },
      },
      SmtpCheckFailure: {
        type: "object",
        required: ["ok", "reason", "message"],
        properties: {
          ok: { type: "boolean", const: false },
          reason: {
            type: "string",
            enum: [
              "host_not_found",
              "connection_refused",
              "connection_timeout",
              "cannot_connect",
              "tls_mismatch",
              "certificate",
              "starttls_unavailable",
              "authentication",
              "rejected",
              "unknown",
            ],
          },
          message: { type: "string", description: "Credential-free explanation." },
        },
      },
      SmtpCheckResult: {
        oneOf: [
          {
            type: "object",
            required: ["ok"],
            properties: { ok: { type: "boolean", const: true } },
          },
          schemaRef("SmtpCheckFailure"),
        ],
      },
      SmtpSendResult: {
        oneOf: [
          {
            type: "object",
            required: ["ok", "messageId"],
            properties: {
              ok: { type: "boolean", const: true },
              messageId: { type: "string" },
            },
          },
          schemaRef("SmtpCheckFailure"),
        ],
      },
      ApiKey: {
        type: "object",
        required: [
          "id",
          "name",
          "prefix",
          "start",
          "enabled",
          "smtpConfigId",
          "createdAt",
          "updatedAt",
        ],
        properties: {
          id: { type: "string" },
          name: { type: ["string", "null"] },
          prefix: { type: ["string", "null"] },
          start: { type: ["string", "null"] },
          enabled: { type: "boolean" },
          smtpConfigId: { type: ["string", "null"] },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      ApiKeyCreated: {
        type: "object",
        required: ["key", "record"],
        properties: {
          key: {
            type: "string",
            description: "Plaintext API key. Shown only once.",
          },
          record: schemaRef("ApiKey"),
        },
      },
      ApiKeyList: {
        type: "object",
        required: ["keys"],
        properties: {
          keys: { type: "array", items: schemaRef("ApiKey") },
        },
      },
      EmailHistory: {
        type: "object",
        required: ["id", "emailId", "status", "error", "attempts", "createdAt"],
        properties: {
          id: { type: "string" },
          emailId: { type: "string" },
          status: {
            type: "string",
            enum: ["received", "processing", "cleaned", "sent", "failed"],
          },
          error: { type: ["string", "null"] },
          attempts: { type: ["integer", "null"] },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      EmailLog: {
        type: "object",
        required: [
          "internalId",
          "userId",
          "apiKeyId",
          "to",
          "subject",
          "smtpId",
          "sentAt",
          "emailProcessingTimeMs",
          "source",
          "smtpConfigId",
          "createdAt",
          "history",
        ],
        properties: {
          internalId: { type: "string" },
          userId: { type: "string" },
          apiKeyId: { type: ["string", "null"] },
          to: { type: "string", format: "email", description: "Decrypted recipient." },
          subject: { type: "string" },
          smtpId: { type: ["string", "null"] },
          sentAt: { type: ["string", "null"], format: "date-time" },
          emailProcessingTimeMs: { type: ["integer", "null"] },
          source: {
            type: "string",
            enum: ["api", "test"],
            description: "`test` for the dashboard's manual test send, `api` for POST /send-email.",
          },
          smtpConfigId: {
            type: ["string", "null"],
            description: "The configuration a test went through; null for an API send.",
          },
          createdAt: { type: "string", format: "date-time" },
          history: { type: "array", items: schemaRef("EmailHistory") },
        },
      },
      EmailLogEnvelope: {
        type: "object",
        required: ["log"],
        properties: { log: schemaRef("EmailLog") },
      },
      EmailLogPage: {
        type: "object",
        required: ["logs", "nextCursor"],
        properties: {
          logs: { type: "array", items: schemaRef("EmailLog") },
          nextCursor: {
            type: ["string", "null"],
            description: "Pass as `cursor` to fetch the next page; null at the end.",
          },
        },
      },
      Template: {
        type: "object",
        required: [
          "id",
          "userId",
          "name",
          "subject",
          "format",
          "source",
          "html",
          "text",
          "createdAt",
          "updatedAt",
        ],
        properties: {
          id: { type: "string" },
          userId: { type: "string" },
          name: { type: "string" },
          subject: { type: "string" },
          format: {
            type: "string",
            enum: ["legacy", "react-email", "react-email-code"],
          },
          editorJson: {
            type: ["string", "null"],
            description:
              "Serialized builder envelope ({ version, theme, content }) for react-email templates. Legacy raw TipTap documents are still accepted.",
          },
          source: {
            type: ["string", "null"],
            description:
              "Pasted TSX source for react-email-code templates. The Worker never executes it.",
          },
          html: { type: "string" },
          text: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      TemplatePreview: {
        type: "object",
        required: ["subject", "html", "text"],
        properties: {
          subject: { type: "string" },
          html: { type: "string" },
          text: { type: "string" },
        },
      },
      TemplatePreviewEnvelope: {
        type: "object",
        required: ["preview"],
        properties: { preview: schemaRef("TemplatePreview") },
      },
      TemplateEnvelope: {
        type: "object",
        required: ["template"],
        properties: { template: schemaRef("Template") },
      },
      TemplateList: {
        type: "object",
        required: ["templates"],
        properties: {
          templates: { type: "array", items: schemaRef("Template") },
        },
      },
      DashboardStats: {
        type: "object",
        required: ["totalSent", "successCount", "failureCount", "successRate"],
        properties: {
          totalSent: { type: "integer" },
          successCount: { type: "integer" },
          failureCount: { type: "integer" },
          successRate: { type: "integer", minimum: 0, maximum: 100 },
        },
      },
      UpdateStatus: {
        type: "object",
        required: [
          "enabled",
          "currentVersion",
          "latestVersion",
          "updateAvailable",
          "checkedAt",
          "source",
          "upstreamRepository",
          "upstreamImage",
        ],
        properties: {
          enabled: { type: "boolean" },
          currentVersion: { type: "string", examples: ["0.1.0"] },
          latestVersion: { type: ["string", "null"], examples: ["0.2.0"] },
          updateAvailable: { type: "boolean" },
          releaseName: { type: ["string", "null"] },
          releaseUrl: { type: ["string", "null"], format: "uri" },
          releaseNotes: { type: ["string", "null"], description: "Markdown, truncated to 4000 characters." },
          publishedAt: { type: ["string", "null"], format: "date-time" },
          checkedAt: { type: ["string", "null"], format: "date-time" },
          error: { type: ["string", "null"], description: "Why the last check failed." },
          source: {
            type: "string",
            enum: ["github", "registry"],
            description: "`registry` on the self-hosting image (`UPDATE_SOURCE=registry`): updating means pulling the image.",
          },
          upstreamRepository: { type: "string", examples: ["lixalistudio-oss/makisend"] },
          upstreamImage: {
            type: ["string", "null"],
            examples: ["ghcr.io/lixalistudio-oss/makisend"],
            description: "The image whose tags are read, `null` when the source is GitHub.",
          },
          syncWorkflowUrl: {
            type: ["string", "null"],
            format: "uri",
            description:
              "The sync workflow of this instance's own repository, when `MAKISEND_REPOSITORY` is set. Always `null` on the Docker image.",
          },
        },
      },
      UpdateStatusEnvelope: {
        type: "object",
        required: ["status"],
        properties: { status: schemaRef("UpdateStatus") },
      },
      DashboardStatsEnvelope: {
        type: "object",
        required: ["stats"],
        properties: { stats: schemaRef("DashboardStats") },
      },
      SmtpConfigBreakdown: {
        type: "object",
        required: ["smtpConfigId", "senderEmail", "totalSent", "successCount", "failureCount"],
        properties: {
          smtpConfigId: { type: "string" },
          senderEmail: { type: "string", format: "email" },
          totalSent: { type: "integer" },
          successCount: { type: "integer" },
          failureCount: { type: "integer" },
        },
      },
      ApiKeyMetrics: {
        type: "object",
        required: [
          "apiKeyId",
          "name",
          "prefix",
          "start",
          "enabled",
          "totalSent",
          "successCount",
          "failureCount",
          "successRate",
          "avgProcessingTimeMs",
          "lastUsedAt",
        ],
        properties: {
          apiKeyId: { type: "string" },
          name: { type: ["string", "null"] },
          prefix: { type: ["string", "null"] },
          start: { type: ["string", "null"] },
          enabled: { type: "boolean" },
          totalSent: { type: "integer" },
          successCount: { type: "integer" },
          failureCount: { type: "integer" },
          successRate: { type: "number", description: "Percentage, 0 when nothing was sent." },
          avgProcessingTimeMs: { type: ["integer", "null"] },
          lastUsedAt: { type: ["string", "null"], format: "date-time" },
        },
      },
      ApiKeyBreakdownEnvelope: {
        type: "object",
        required: ["breakdown"],
        properties: {
          breakdown: { type: "array", items: schemaRef("ApiKeyMetrics") },
        },
      },
      SmtpBreakdownEnvelope: {
        type: "object",
        required: ["breakdown"],
        properties: {
          breakdown: { type: "array", items: schemaRef("SmtpConfigBreakdown") },
        },
      },
      RecentEmail: {
        type: "object",
        required: [
          "internalId",
          "to",
          "subject",
          "status",
          "sentAt",
          "emailProcessingTimeMs",
        ],
        properties: {
          internalId: { type: "string" },
          to: { type: "string", format: "email" },
          subject: { type: "string" },
          status: { type: "string" },
          sentAt: { type: "string", format: "date-time" },
          emailProcessingTimeMs: { type: ["integer", "null"] },
        },
      },
      RecentEmailsEnvelope: {
        type: "object",
        required: ["recent"],
        properties: {
          recent: { type: "array", items: schemaRef("RecentEmail") },
        },
      },
      ErrorSummary: {
        type: "object",
        required: ["error", "count"],
        properties: {
          error: { type: "string" },
          count: { type: "integer" },
        },
      },
      ErrorSummariesEnvelope: {
        type: "object",
        required: ["errors"],
        properties: {
          errors: { type: "array", items: schemaRef("ErrorSummary") },
        },
      },
      CreateWebhookEndpoint: createWebhookEndpointSchema,
      UpdateWebhookEndpoint: updateWebhookEndpointSchema,
      RotateWebhookSecret: rotateWebhookSecretSchema,
      WebhookEndpoint: {
        type: "object",
        description: "A receiving endpoint. The secret is never part of it.",
        required: ["id", "url", "enabled", "disabledReason", "rotationEndsAt", "createdAt", "updatedAt"],
        properties: {
          id: { type: "string" },
          url: { type: "string", format: "uri", description: "Normalized URL, decrypted for display." },
          enabled: { type: "boolean", description: "`false`: nothing is published or sent to it." },
          disabledReason: {
            type: ["string", "null"],
            enum: [...WEBHOOK_DISABLED_REASONS, null],
            description: `\`auto\`: disabled after ${WEBHOOK_AUTO_DISABLE_THRESHOLD} abandoned deliveries in a row. Turn it on again with \`PUT\` \`{ "enabled": true }\`.`,
          },
          rotationEndsAt: {
            type: ["string", "null"],
            format: "date-time",
            description: "End of the window in which the previous secret still signs; null outside a rotation.",
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      WebhookEndpointEnvelope: {
        type: "object",
        required: ["endpoint"],
        properties: { endpoint: schemaRef("WebhookEndpoint") },
      },
      WebhookEndpointList: {
        type: "object",
        required: ["endpoints"],
        properties: { endpoints: { type: "array", items: schemaRef("WebhookEndpoint") } },
      },
      WebhookEndpointWithSecret: {
        type: "object",
        required: ["endpoint", "secret"],
        properties: {
          endpoint: schemaRef("WebhookEndpoint"),
          secret: {
            type: "string",
            pattern: "^whsec_",
            description: "Signing secret. Shown once: it cannot be read again, only rotated.",
          },
        },
      },
      WebhookTestResult: {
        type: "object",
        required: ["ok", "statusCode", "error", "durationMs"],
        properties: {
          ok: { type: "boolean", description: "The receiver answered 2xx in time." },
          statusCode: { type: ["integer", "null"], description: "null when there was no answer." },
          error: {
            type: ["string", "null"],
            description: "`timeout`, `network error`, `HTTP 500`, `url refused`… Never the receiver's body.",
          },
          durationMs: { type: "integer" },
        },
      },
      WebhookDelivery: {
        type: "object",
        required: [
          "id",
          "eventType",
          "emailId",
          "status",
          "attempts",
          "lastStatusCode",
          "lastError",
          "lastAttemptAt",
          "deliveredAt",
          "createdAt",
        ],
        properties: {
          id: { type: "string", description: "`webhook-id` of the requests is `msg_<id>`." },
          eventType: { type: "string", enum: [...WEBHOOK_EVENT_TYPES] },
          emailId: { type: ["string", "null"], description: "null for a test event." },
          status: {
            type: "string",
            enum: [...WEBHOOK_DELIVERY_STATUSES],
            description: "`skipped`: the endpoint was disabled or the email deleted before sending.",
          },
          attempts: { type: "integer" },
          lastStatusCode: { type: ["integer", "null"] },
          lastError: { type: ["string", "null"], description: "Short reason, never the receiver's body." },
          lastAttemptAt: { type: ["string", "null"], format: "date-time" },
          deliveredAt: { type: ["string", "null"], format: "date-time" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      WebhookDeliveryEnvelope: {
        type: "object",
        required: ["delivery"],
        properties: { delivery: schemaRef("WebhookDelivery") },
      },
      WebhookDeliveryPage: {
        type: "object",
        required: ["deliveries", "nextCursor"],
        properties: {
          deliveries: { type: "array", items: schemaRef("WebhookDelivery") },
          nextCursor: {
            type: ["string", "null"],
            description: "Pass as `cursor` to fetch the next page; null at the end.",
          },
        },
      },
      WebhookHistoryEntry: {
        type: "object",
        required: ["status", "attempt", "at", "reason"],
        properties: {
          status: { type: "string", description: "e.g. `attempt_failed`, `sent`, `failed`." },
          attempt: { type: ["integer", "null"] },
          at: { type: "string", format: "date-time" },
          reason: {
            type: ["string", "null"],
            description: "Filtered, human-readable reason: never the raw SMTP error, host or address.",
          },
        },
      },
      WebhookEmailEvent: {
        type: "object",
        description:
          "Body of `email.sent` and `email.failed`. Fields may be added later, never removed or renamed. Never carries the email body, attachments, SMTP host or credentials, or the API key.",
        required: ["type", "timestamp", "data"],
        properties: {
          type: { type: "string", enum: ["email.sent", "email.failed"] },
          timestamp: { type: "string", format: "date-time" },
          data: {
            type: "object",
            required: [
              "emailId",
              "status",
              "to",
              "subject",
              "apiKeyId",
              "smtpMessageId",
              "attempts",
              "createdAt",
              "completedAt",
              "history",
            ],
            properties: {
              emailId: { type: "string", description: "The id returned by `POST /send-email`." },
              status: { type: "string", enum: ["sent", "failed"] },
              to: { type: "string" },
              subject: { type: "string" },
              apiKeyId: { type: ["string", "null"] },
              smtpMessageId: { type: ["string", "null"], description: "null for `email.failed`." },
              attempts: { type: "integer", description: "SMTP attempts made." },
              failureKind: {
                type: "string",
                enum: [...WEBHOOK_FAILURE_KINDS],
                description: "`email.failed` only.",
              },
              reason: { type: "string", description: "`email.failed` only. Filtered, human-readable." },
              createdAt: { type: "string", format: "date-time", description: "When the API accepted the email." },
              completedAt: { type: "string", format: "date-time", description: "When the final status was written." },
              history: {
                type: "array",
                maxItems: WEBHOOK_HISTORY_MAX_ENTRIES,
                description: `Status changes, oldest first, the ${WEBHOOK_HISTORY_MAX_ENTRIES} most recent.`,
                items: schemaRef("WebhookHistoryEntry"),
              },
            },
          },
        },
      },
      WebhookTestEvent: {
        type: "object",
        required: ["type", "timestamp", "data"],
        properties: {
          type: { type: "string", const: "webhook.test" },
          timestamp: { type: "string", format: "date-time" },
          data: {
            type: "object",
            required: ["endpointId", "message"],
            properties: {
              endpointId: { type: "string" },
              message: { type: "string" },
            },
          },
        },
      },
      SuccessResponse: {
        type: "object",
        required: ["success"],
        properties: { success: { type: "boolean", const: true } },
      },
      Error: {
        type: "object",
        required: ["success", "error"],
        properties: {
          success: { type: "boolean", const: false },
          error: { type: "string" },
        },
      },
      ValidationError: {
        type: "object",
        required: ["error"],
        properties: {
          error: { type: "string" },
          details: {
            type: "object",
            properties: {
              fieldErrors: {
                type: "object",
                additionalProperties: { type: "array", items: { type: "string" } },
              },
              formErrors: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
    },
    responses: {
      Unauthorized: jsonResponse("Missing or invalid credentials.", "Error"),
      Forbidden: jsonResponse("Credentials are valid but the resource is not accessible.", "Error"),
      NotFound: jsonResponse("Resource not found.", "Error"),
      ValidationError: jsonResponse("Request validation failed.", "ValidationError"),
      Conflict: jsonResponse("Idempotency key conflict.", "Error"),
      ServerError: jsonResponse("Unexpected server error.", "Error"),
    },
  },
} as const;
