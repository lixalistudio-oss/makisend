// --- Framework & core imports ---
import { Hono } from "hono";
import { cors } from "hono/cors";
import { Scalar } from "@scalar/hono-api-reference";

// --- Middleware imports ---
import { errorHandler } from "@/middleware/error.handler";
import { requestLoggerMiddleware } from "@/middleware/request-logger.middleware";
import { securityHeadersMiddleware } from "@/middleware/security-headers.middleware";
import { configMiddleware } from "@/middleware/config.middleware";
import { apiKeyMiddleware } from "@/middleware/api-key.middleware";
import { sessionMiddleware } from "@/middleware/session.middleware";

// --- Module imports ---
import { createSendEmailController } from "@/send-email";
import { createSmtpConfigController, SmtpConfigRepository, SmtpConfigService } from "@/smtp-config";
import { createApiKeysController, ApiKeyRepository, ApiKeyService } from "@/api-keys";
import { createEmailLogsController, EmailLogRepository, EmailLogService } from "@/email-logs";
import { createDashboardController, DashboardRepository, DashboardService } from "@/dashboard";
import { createTemplatesController, TemplateRepository, TemplateService } from "@/templates";
import {
  IdempotencyRepository,
  IdempotencyService,
  idempotencyMiddleware,
} from "@/idempotency";
import { sendEmailQueueConsumer } from "@/queue/send-email.consumer";
import { runSmtpHealthChecks } from "@/smtp-config/smtp-health";
import { openApiDocument } from "@/openapi";

// --- Better Auth ---
import { createAuth } from "@/lib/auth";

// --- Database & repository imports ---
import { createDatabase } from "@/db/connection";
import { SendEmailRepository } from "@/send-email/send-email.repository";

// --- Type imports ---
import { resolveEncryptionKeys, type SmtpConfig, type UserConfig } from "./config/config";
import type { EncryptionKeys } from "@/core/crypto";
import { runKeyRotation, KEY_ROTATION_CRON } from "@/key-rotation";
import { needsSetup } from "@/lib/owner-lock";
import type { IEmailRepository, SendEmailQueueMessage } from "@/send-email/send-email.types";
import type { ISmtpConfigRepository } from "@/smtp-config/smtp-config.types";
import type { IApiKeyRepository } from "@/api-keys/api-keys.types";
import type { IEmailLogRepository } from "@/email-logs/email-logs.types";
import type { IDashboardRepository } from "@/dashboard/dashboard.types";
import type { ITemplateRepository } from "@/templates/templates.types";
import type { IIdempotencyRepository } from "@/idempotency";

// --- Cloudflare Worker environment bindings ---
export type Bindings = {
  // Current AES-256 key (64 hex). Encrypts every new value.
  ENCRYPTION_KEY?: string;
  // Decrypt-only keys kept during a rotation, comma-separated. Remove once the
  // key-rotation job reports nothing left to re-encrypt.
  ENCRYPTION_KEY_PREVIOUS?: string;
  // Legacy name of the key: still read (see resolveEncryptionKeys) until it is deleted.
  AES_256_KEY?: string;
  makisend_db: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  FRONTEND_URL: string;
  // "off" disables the auth rate limiter (local dev and tests only). Anything else, or
  // unset, keeps it on: production and preview never set it.
  RATE_LIMIT?: string;
  SEND_EMAIL_QUEUE: Queue<SendEmailQueueMessage>;
  SEND_EMAIL_DLQ: Queue<SendEmailQueueMessage>;
  SEND_EMAIL_WORKFLOW: Workflow;
  // Static assets binding (frontend/dist) — handled by the platform before the
  // Worker script; declared so the Bindings type matches wrangler.jsonc.
  ASSETS: Fetcher;
};

// --- Hono context variables (per-request) ---
export type UserInfoVariables = {
  userConfig: UserConfig;
  smtpConfig: SmtpConfig;
  userId: string;
  apiKeyId: string;
  smtpConfigId: string;
};

// Auth instance: recreate if baseURL or frontend URL changes (e.g. first request before secrets are set)
let authInstance: ReturnType<typeof createAuth> | null = null;
let authBaseUrl: string | null = null;
let authFrontendUrl: string | null = null;

function getAuthInstance(env: Bindings) {
  if (
    !authInstance ||
    env.BETTER_AUTH_URL !== authBaseUrl ||
    env.FRONTEND_URL !== authFrontendUrl
  ) {
    authInstance = createAuth(env);
    authBaseUrl = env.BETTER_AUTH_URL;
    authFrontendUrl = env.FRONTEND_URL;
  }
  return authInstance;
}

// --- Lazy dependency container ---
const deps = {
  emailRepository: null as IEmailRepository | null,
  smtpConfigRepository: null as ISmtpConfigRepository | null,
  apiKeyRepository: null as IApiKeyRepository | null,
  emailLogRepository: null as IEmailLogRepository | null,
  dashboardRepository: null as IDashboardRepository | null,
  templateRepository: null as ITemplateRepository | null,
  idempotencyRepository: null as IIdempotencyRepository | null,
  smtpConfigService: null as SmtpConfigService | null,
  apiKeyService: null as ApiKeyService | null,
  emailLogService: null as EmailLogService | null,
  dashboardService: null as DashboardService | null,
  templateService: null as TemplateService | null,
  idempotencyService: null as IdempotencyService | null,
  aesKey: null as EncryptionKeys | null,
  dbInitialized: false,

  initDb(env: Bindings) {
    if (this.dbInitialized) return;

    const db = createDatabase(env.makisend_db);
    const auth = getAuthInstance(env);
    this.emailRepository = new SendEmailRepository(db);
    this.smtpConfigRepository = new SmtpConfigRepository(db);
    this.apiKeyRepository = new ApiKeyRepository(db, auth);
    this.emailLogRepository = new EmailLogRepository(db);
    this.dashboardRepository = new DashboardRepository(db);
    this.templateRepository = new TemplateRepository(db);
    this.idempotencyRepository = new IdempotencyRepository(db);
    this.aesKey = resolveEncryptionKeys(env);
    this.dbInitialized = true;
  },

  initServices() {
    if (this.smtpConfigService) return;
    this.smtpConfigService = new SmtpConfigService(
      this.smtpConfigRepository!,
      this.aesKey!,
    );
    this.apiKeyService = new ApiKeyService(this.apiKeyRepository!);
    this.emailLogService = new EmailLogService(this.emailLogRepository!, this.aesKey!);
    this.dashboardService = new DashboardService(this.dashboardRepository!, this.aesKey!);
    this.templateService = new TemplateService(this.templateRepository!);
    this.idempotencyService = new IdempotencyService(this.idempotencyRepository!);
  },
};

// --- Hono app setup ---
const app = new Hono<{ Bindings: Bindings; Variables: UserInfoVariables }>();

/**
 * CORS allowlist: the dashboard origin (`FRONTEND_URL`) and nothing else.
 *
 * The session cookie is `SameSite=None` (dashboard and API live on different sites),
 * and credentialed responses include decrypted SMTP credentials. Reflecting any
 * origin would let every website a logged-in admin visits read them, so an origin
 * that is not exactly the dashboard gets no CORS headers at all.
 */
function allowedOrigin(origin: string | undefined, env: Bindings): string | null {
  const frontend = env.FRONTEND_URL?.replace(/\/+$/, "");
  return origin && frontend && origin === frontend ? origin : null;
}

// Global middleware: security headers, CORS, request logging, error handling, config injection
app.use("*", securityHeadersMiddleware());
app.use("*", async (c, next) => {
  // Any other origin gets no CORS headers at all (Hono's middleware would still send
  // `Allow-Credentials: true` once `credentials` is on): a preflight is answered
  // empty, so the browser refuses the request.
  if (!allowedOrigin(c.req.header("origin"), c.env)) {
    if (c.req.method === "OPTIONS") return c.body(null, 204);
    return next();
  }
  return cors({
    origin: (origin) => allowedOrigin(origin, c.env),
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization", "x-api-key", "Idempotency-Key"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Idempotency-Replayed"],
  })(c, next);
});
app.use("*", requestLoggerMiddleware());
app.onError(errorHandler);
app.use(configMiddleware());

// Public API documentation. Registered before the lazily initialized DB
// middleware so the schema and reference work even if D1 is unavailable.
app.get("/openapi.json", (c) => c.json(openApiDocument));
app.get(
  "/docs",
  Scalar((c) => ({
    url: "/openapi.json",
    pageTitle: "MakiSend API Reference",
    nonce: c.get("cspNonce"),
    theme: "default",
    cdn: "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.75.1",
  })),
);

// Better Auth: forward raw Request to auth.handler() for all /api/auth/* routes.
// We wrap the result to add CORS headers that Hono's middleware can't inject into
// raw Response objects.

function addCorsHeaders(
  result: Response,
  origin: string | undefined,
  env: Bindings,
): Response {
  const headers = new Headers(result.headers);
  const allowed = allowedOrigin(origin, env);
  if (allowed) {
    headers.set("Access-Control-Allow-Origin", allowed);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.append("Vary", "Origin");
  }
  return new Response(result.body, {
    status: result.status,
    statusText: result.statusText,
    headers,
  });
}

// Public: whether the instance still has to be set up. While no account exists the dashboard
// sends every visitor to the set-up page, where the first connection creates the super admin.
app.get("/api/setup-status", async (c) => {
  return c.json({ needsSetup: await needsSetup(c.env.makisend_db) });
});

// Better Auth hardcodes `name: z.string()` in its sign-up body schema and offers no
// option to relax it, while our product only asks for email + password. We fill it in
// with the local part of the email before handing the request over to Better Auth.
// Whether an account may be created at all is decided by the owner lock (src/lib/auth.ts,
// src/lib/owner-lock.ts), on every creation path, atomically.
app.post("/api/auth/sign-up/email", async (c) => {
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const fallbackName = String(body.email ?? "").split("@")[0];
  const auth = getAuthInstance(c.env);
  const result = await auth.handler(
    new Request(c.req.raw.url, {
      method: c.req.raw.method,
      headers: c.req.raw.headers,
      body: JSON.stringify({ ...body, name: body.name || fallbackName }),
    }),
  );
  return addCorsHeaders(result, c.req.header("origin"), c.env);
});

app.all("/api/auth/*", async (c) => {
  const auth = getAuthInstance(c.env);
  const result = await auth.handler(c.req.raw);
  return addCorsHeaders(result, c.req.header("origin"), c.env);
});

// API key auth (Better Auth) on send-email routes
app.use("/send-email/*", async (c, next) => {
  const config = c.get("appConfig");
  const auth = getAuthInstance(c.env);
  await apiKeyMiddleware(config, auth)(c, next);
});

// Initialize DB deps on first request (doesn't need smtpConfig)
app.use("*", async (c, next) => {
  if (!deps.dbInitialized) {
    deps.initDb(c.env);
  }
  if (!deps.smtpConfigService) {
    deps.initServices();
  }
  await next();
});

// HTTP-level idempotency for POST /send-email. Runs after API-key auth, so the
// key is scoped to the caller, and after DB deps are initialized.
app.use("/send-email/*", idempotencyMiddleware(() => deps.idempotencyService!));

// Mount send-email controller — produces to the Cloudflare Queue
const sendEmailController = createSendEmailController(
  () => deps.emailRepository!,
  () => deps.templateRepository!,
);
app.route("/send-email", sendEmailController);

// Mount SMTP config controller with session auth
const smtpConfigController = createSmtpConfigController(
  () => deps.smtpConfigService!,
);
app.use("/smtp-config/*", async (c, next) => {
  const auth = getAuthInstance(c.env);
  return sessionMiddleware(auth)(c, next);
});
app.route("/smtp-config", smtpConfigController);

// Mount API keys controller with session auth
const apiKeysController = createApiKeysController(
  () => deps.apiKeyService!,
);
app.use("/api-keys/*", async (c, next) => {
  const auth = getAuthInstance(c.env);
  return sessionMiddleware(auth)(c, next);
});
app.route("/api-keys", apiKeysController);

// Mount email logs controller with session auth
const emailLogsController = createEmailLogsController(
  () => deps.emailLogService!,
);
app.use("/email-logs*", async (c, next) => {
  const auth = getAuthInstance(c.env);
  return sessionMiddleware(auth)(c, next);
});
app.route("/email-logs", emailLogsController);

// Mount dashboard controller with session auth
const dashboardController = createDashboardController(
  () => deps.dashboardService!,
);
app.use("/dashboard/*", async (c, next) => {
  const auth = getAuthInstance(c.env);
  return sessionMiddleware(auth)(c, next);
});
app.route("/dashboard", dashboardController);

// Mount templates controller with session auth (dashboard CRUD)
const templatesController = createTemplatesController(
  () => deps.templateService!,
);
app.use("/templates*", async (c, next) => {
  const auth = getAuthInstance(c.env);
  return sessionMiddleware(auth)(c, next);
});
app.route("/templates", templatesController);

// Worker entrypoint: HTTP requests via Hono, queue messages via the consumer.
// The Hono app is also exported by name so tests can call `app.request(...)`.
// SendEmailWorkflow must be exported from the entrypoint for wrangler's
// `class_name` to resolve.
export { app };
export { SendEmailWorkflow } from "@/workflows";
export default {
  fetch: app.fetch,
  queue: sendEmailQueueConsumer,
  scheduled: async (
    _controller: ScheduledController,
    env: Bindings,
    ctx: ExecutionContext,
  ) => {
    // Daily (17 3 * * *): SMTP health checks. Hourly (17 * * * *): key rotation, which
    // re-encrypts values still on a previous encryption key (a no-op when nothing is stale).
    if (_controller.cron === KEY_ROTATION_CRON) {
      ctx.waitUntil(runKeyRotation(env));
      return;
    }
    ctx.waitUntil(runSmtpHealthChecks(env));
  },
};
