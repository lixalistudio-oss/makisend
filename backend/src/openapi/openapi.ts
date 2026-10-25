import { z } from "zod";
import { CreateApiKeyDto } from "@/api-keys/api-keys.dto";
import { SendEmailPayloadDto } from "@/send-email/send-email.dto";
import {
  CreateSmtpConfigDto,
  SetBounceWebhookDto,
  TestSendDto,
  UpdateSmtpConfigDto,
} from "@/smtp-config/smtp-config.dto";
import { BOUNCE_WEBHOOK_PROVIDERS } from "@/bounce-webhooks/bounce-webhooks.types";
import { SMTP_PORTS } from "@/smtp-config/smtp-host";
import { AddSuppressionDto } from "@/suppressions/suppressions.dto";
import {
  CreateTemplateDto,
  PreviewTemplateDto,
  UpdateTemplateDto,
} from "@/templates/templates.dto";

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
  "SMTP credentials to create or test. The password is encrypted at rest and never returned.",
);
patchProperty(createSmtpConfigSchema, "smtpHostname", {
  description: "Provider hostname without a scheme, port, or path.",
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
    { name: "SMTP Config", description: "Manage encrypted SMTP credentials." },
    { name: "API Keys", description: "Manage per-configuration API keys." },
    { name: "Email Logs", description: "Inspect delivery logs and history." },
    { name: "Dashboard", description: "Aggregated delivery metrics." },
    { name: "Templates", description: "Reusable email templates with variables." },
    { name: "Suppressions", description: "Addresses POST /send-email refuses to send to." },
    { name: "Webhooks", description: "Delivery events posted by your SMTP provider (bounces, complaints)." },
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
          "Accepts either inline content (`subject`, `text`, `html`) or a `templateId` plus `variables`. The two shapes are mutually exclusive. HTML is sanitized before delivery. Send the optional `Idempotency-Key` header to make retries safe.",
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
          422: jsonResponse(
            "The recipient is on the suppression list (rejected as non-existent by its server, or added from the dashboard). Nothing was stored or queued.",
            "Error",
          ),
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
          "Hostname, username, password, and sender address are encrypted at rest. Allowed ports are 465, 587, 2465, 2525, and 2587; port 25 is blocked on Workers. When `smtpSecurity` is omitted it defaults to `tls` on 465/2465 and `starttls` otherwise.",
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
          "Opens an SMTP connection with the submitted credentials without persisting them. Works for inactive configurations too.",
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
    "/smtp-config/{id}/dns-check": {
      get: {
        tags: ["SMTP Config"],
        summary: "Check the sender domain's DNS (SPF, DKIM, DMARC, MX)",
        operationId: "checkSmtpConfigDns",
        description:
          "Reads the public DNS records of the configuration's sender domain over DNS-over-HTTPS and grades each one. MakiSend does not sign mail itself: these records are published with your SMTP provider's values. Without `dkimSelector`, the usual providers' selectors are tried, and not finding one answers `unknown`, not `fail`.",
        security: sessionSecurity,
        parameters: [
          idParameter,
          {
            name: "dkimSelector",
            in: "query",
            required: false,
            description: "DKIM selector to check (the `s=` value of the DKIM-Signature header), e.g. `s1` or `google`.",
            schema: { type: "string", maxLength: 253 },
          },
        ],
        responses: {
          200: jsonResponse("DNS check result; lookups that fail answer `unknown`.", "DnsCheckResult"),
          400: responseRef("ValidationError"),
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
          "Sends a one-off message through the saved configuration. It is recorded in the email logs with `source: \"test\"` and this configuration's id, and never counted in the dashboard totals.",
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
    "/smtp-config/{id}/bounce-webhook": {
      put: {
        tags: ["SMTP Config"],
        summary: "Connect the provider's bounce webhook",
        operationId: "setSmtpConfigBounceWebhook",
        description:
          "Point the provider's webhook at `POST /webhooks/bounces/{id}`, then save its secret here. From now on, sends through this configuration carry the provider's correlation tag, and its delivery, delay, bounce and complaint events update the email logs; hard bounces and complaints add the address to the suppression list. Replaces any webhook already connected.",
        security: sessionSecurity,
        parameters: [idParameter],
        requestBody: {
          required: true,
          content: { "application/json": { schema: schemaRef("SetBounceWebhook") } },
        },
        responses: {
          200: jsonResponse("Webhook connected.", "SmtpConfigEnvelope"),
          400: responseRef("ValidationError"),
          ...sessionErrors,
          404: responseRef("NotFound"),
        },
      },
      delete: {
        tags: ["SMTP Config"],
        summary: "Disconnect the bounce webhook",
        operationId: "removeSmtpConfigBounceWebhook",
        description: "Its requests are refused from now on.",
        security: sessionSecurity,
        parameters: [idParameter],
        responses: {
          200: jsonResponse("Webhook disconnected.", "SmtpConfigEnvelope"),
          ...sessionErrors,
          404: responseRef("NotFound"),
        },
      },
    },
    "/webhooks/bounces/{smtpConfigId}": {
      post: {
        tags: ["Webhooks"],
        summary: "Receive the provider's delivery events",
        operationId: "receiveBounceWebhook",
        description:
          "Called by the SMTP provider, not by your application. Authenticated by the configuration's webhook secret: Svix signature (Resend), Signed Event Webhook (SendGrid), signing key (Mailgun) or Basic auth (Postmark). Each event is applied once, matched to the email through the provider's correlation tag or the Message-ID `<emailId@sender-domain>` MakiSend sets. An unknown configuration, one without a webhook and a bad signature all answer 401.",
        security: [],
        parameters: [
          {
            name: "smtpConfigId",
            in: "path",
            required: true,
            description: "The SMTP configuration whose webhook receives the events.",
            schema: { type: "string", minLength: 1, maxLength: 128 },
          },
        ],
        requestBody: {
          required: true,
          description: "The provider's own payload, unchanged.",
          content: { "application/json": { schema: {} } },
        },
        responses: {
          200: jsonResponse("Events applied.", "WebhookReport"),
          400: { description: "The body is not JSON." },
          401: { description: "Unknown configuration, no webhook connected, or invalid signature." },
          413: { description: "Body over 2 MB or more than 1000 events." },
          500: responseRef("ServerError"),
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
    "/suppressions": {
      get: {
        tags: ["Suppressions"],
        summary: "List suppressed addresses",
        operationId: "listSuppressions",
        description:
          "Newest first, at most 1000. An address is added when its server rejects it as non-existent during RCPT TO (550 5.1.1 and similar), when the provider's bounce webhook reports a hard bounce or a spam complaint, or by hand.",
        security: sessionSecurity,
        responses: {
          200: jsonResponse("The suppression list.", "SuppressionList"),
          ...sessionErrors,
        },
      },
      post: {
        tags: ["Suppressions"],
        summary: "Suppress an address",
        operationId: "addSuppression",
        security: sessionSecurity,
        requestBody: {
          required: true,
          content: { "application/json": { schema: schemaRef("AddSuppression") } },
        },
        responses: {
          201: jsonResponse("Address added.", "SuppressionAdded"),
          200: jsonResponse("Address was already suppressed; the first reason is kept.", "SuppressionAdded"),
          400: responseRef("ValidationError"),
          ...sessionErrors,
        },
      },
    },
    "/suppressions/{id}": {
      delete: {
        tags: ["Suppressions"],
        summary: "Remove an address from the suppression list",
        operationId: "deleteSuppression",
        security: sessionSecurity,
        parameters: [idParameter],
        responses: {
          200: jsonResponse("Removed: the address can be sent to again.", "SuccessResponse"),
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
              enum: ["received", "processing", "cleaned", "sent", "failed", "delivered", "deferred", "bounced", "complained"],
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
    "/updates/status": {
      get: {
        tags: ["Updates"],
        summary: "New-release check",
        operationId: "getUpdateStatus",
        description:
          "Compares this build with the latest release of the upstream repository (GitHub, checked at most daily and cached in D1). `UPDATE_CHECK=off` turns the check off.",
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
          "bounceWebhookProvider",
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
          bounceWebhookProvider: {
            type: ["string", "null"],
            enum: [...BOUNCE_WEBHOOK_PROVIDERS, null],
            description:
              "Provider whose delivery events `POST /webhooks/bounces/{id}` accepts, or null. The webhook secret is never returned.",
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
      AddSuppression: inputSchema(AddSuppressionDto, "Address to suppress, with an optional reason."),
      SetBounceWebhook: inputSchema(
        SetBounceWebhookDto,
        "Provider and secret of the bounce webhook. Resend: the signing secret (`whsec_...`). SendGrid: the Signed Event Webhook verification key. Mailgun: the HTTP webhook signing key. Postmark: a password of 16+ characters, also set as the webhook's Basic auth password in Postmark.",
      ),
      WebhookReport: {
        type: "object",
        required: ["success", "received", "duplicates", "matched", "suppressed"],
        properties: {
          success: { type: "boolean", const: true },
          received: { type: "integer", description: "Delivery events MakiSend tracks in this request." },
          duplicates: { type: "integer", description: "Events already applied (provider retries)." },
          matched: { type: "integer", description: "Events tied to an email MakiSend sent." },
          suppressed: { type: "integer", description: "Addresses added to the suppression list." },
        },
      },
      Suppression: {
        type: "object",
        required: ["id", "email", "source", "reason", "emailId", "createdAt"],
        properties: {
          id: { type: "string" },
          email: { type: "string", format: "email" },
          source: {
            type: "string",
            enum: ["bounce", "complaint", "manual"],
            description: "`complaint`: the recipient marked an email as spam (reported by the provider's webhook).",
          },
          reason: { type: "string" },
          emailId: {
            type: ["string", "null"],
            description: "The send that bounced or was complained about, when it could be identified.",
          },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      SuppressionList: {
        type: "object",
        required: ["suppressions"],
        properties: { suppressions: { type: "array", items: schemaRef("Suppression") } },
      },
      SuppressionAdded: {
        type: "object",
        required: ["success", "created"],
        properties: {
          success: { type: "boolean", const: true },
          created: { type: "boolean", description: "False when the address was already on the list." },
        },
      },
      DnsCheckItem: {
        type: "object",
        required: ["status", "code", "message"],
        properties: {
          status: { type: "string", enum: ["pass", "warn", "fail", "unknown"] },
          code: {
            type: "string",
            description: "Stable outcome id, e.g. `spf_missing`, `dkim_selector_unknown`, `dmarc_monitoring`, `lookup_failed`.",
          },
          message: { type: "string", description: "English explanation." },
          record: { type: "string", description: "The record that was evaluated." },
        },
      },
      DnsCheckResult: {
        type: "object",
        required: ["domain", "spf", "dkim", "dmarc", "mx", "checkedAt"],
        properties: {
          domain: { type: "string" },
          spf: schemaRef("DnsCheckItem"),
          dkim: {
            allOf: [
              schemaRef("DnsCheckItem"),
              { type: "object", properties: { selector: { type: "string" } } },
            ],
          },
          dmarc: {
            allOf: [
              schemaRef("DnsCheckItem"),
              {
                type: "object",
                properties: {
                  policy: { type: "string", enum: ["none", "quarantine", "reject"] },
                  recordDomain: { type: "string", description: "Domain the record was found on (the organizational domain for a subdomain sender)." },
                },
              },
            ],
          },
          mx: schemaRef("DnsCheckItem"),
          checkedAt: { type: "string", format: "date-time" },
        },
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
            enum: ["received", "processing", "cleaned", "sent", "failed", "delivered", "deferred", "bounced", "complained"],
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
        required: ["enabled", "currentVersion", "latestVersion", "updateAvailable", "checkedAt", "upstreamRepository"],
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
          upstreamRepository: { type: "string", examples: ["lixalistudio-oss/makisend"] },
          syncWorkflowUrl: {
            type: ["string", "null"],
            format: "uri",
            description: "The sync workflow of this instance's own repository, when `MAKISEND_REPOSITORY` is set.",
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
