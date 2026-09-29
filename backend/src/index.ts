// --- Framework & core imports ---
import { Hono } from "hono";
import { cors } from "hono/cors";

// --- Middleware imports ---
import { errorHandler } from "@/middleware/error.handler";
import { requestLoggerMiddleware } from "@/middleware/request-logger.middleware";
import { configMiddleware } from "@/middleware/config.middleware";
import { apiKeyMiddleware } from "@/middleware/api-key.middleware";
import { sessionMiddleware } from "@/middleware/session.middleware";

// --- Module imports ---
import { createSendEmailController, SmtpEmailTransport } from "@/send-email";
import { createSmtpConfigController, SmtpConfigRepository, SmtpConfigService } from "@/smtp-config";
import { createApiKeysController, ApiKeyRepository, ApiKeyService } from "@/api-keys";
import { createEmailLogsController, EmailLogRepository, EmailLogService } from "@/email-logs";
import { createDashboardController, DashboardRepository, DashboardService } from "@/dashboard";
import { configureDeps, getInngestClient } from "@/inngest/client";
import { getFunctions } from "@/inngest/functions";
import { serve } from "inngest/hono";

// --- Better Auth ---
import { createAuth } from "@/lib/auth";

// --- Database & repository imports ---
import { createDatabase } from "@/db/connection";
import { SendEmailRepository } from "@/send-email/send-email.repository";
import { user } from "@/db/schema";

// --- Type imports ---
import type { SmtpConfig, UserConfig } from "./config/config";
import type { IEmailTransport, IEmailRepository } from "@/send-email/send-email.types";
import type { ISmtpConfigRepository } from "@/smtp-config/smtp-config.types";
import type { IApiKeyRepository } from "@/api-keys/api-keys.types";
import type { IEmailLogRepository } from "@/email-logs/email-logs.types";
import type { IDashboardRepository } from "@/dashboard/dashboard.types";

// --- Cloudflare Worker environment bindings ---
export type Bindings = {
  AES_256_KEY: string;
  makisend_db: D1Database;
  PORT: number;
  INNGEST_DEV: number;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  FRONTEND_URL: string;
};

// --- Hono context variables (per-request) ---
export type UserInfoVariables = {
  userConfig: UserConfig;
  smtpConfig: SmtpConfig;
  userId: string;
  apiKeyId: string;
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
  transport: null as IEmailTransport | null,
  emailRepository: null as IEmailRepository | null,
  smtpConfigRepository: null as ISmtpConfigRepository | null,
  apiKeyRepository: null as IApiKeyRepository | null,
  emailLogRepository: null as IEmailLogRepository | null,
  dashboardRepository: null as IDashboardRepository | null,
  smtpConfigService: null as SmtpConfigService | null,
  apiKeyService: null as ApiKeyService | null,
  emailLogService: null as EmailLogService | null,
  dashboardService: null as DashboardService | null,
  aesKey: null as string | null,
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
    this.aesKey = env.AES_256_KEY;
    this.dbInitialized = true;

    configureDeps(this.transport!, this.emailRepository!, this.aesKey!, this.smtpConfigRepository!);
  },

  initTransport(env: Bindings, smtpConfig: SmtpConfig) {
    if (this.transport) return;

    this.transport = new SmtpEmailTransport(
      { port: env.PORT, aesKey: env.AES_256_KEY, db: env.makisend_db, inngestConfig: env.INNGEST_DEV, better_auth_secret: env.BETTER_AUTH_SECRET, better_auth_url: env.BETTER_AUTH_URL },
      smtpConfig,
    );

    configureDeps(this.transport, this.emailRepository!, this.aesKey!, this.smtpConfigRepository!);
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
  },
};

// --- Hono app setup ---
const app = new Hono<{ Bindings: Bindings; Variables: UserInfoVariables }>();

// Global middleware: CORS, request logging, error handling, config injection
app.use("*", cors({
  origin: (origin) => origin,
  credentials: true,
  allowHeaders: ["Content-Type", "Authorization"],
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
}));
app.use("*", requestLoggerMiddleware());
app.onError(errorHandler);
app.use(configMiddleware());

// Better Auth: forward raw Request to auth.handler() for all /api/auth/* routes.
// We wrap the result to add CORS headers that Hono's middleware can't inject into
// raw Response objects.

function addCorsHeaders(result: Response, origin: string | undefined): Response {
  const headers = new Headers(result.headers);
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
  }
  return new Response(result.body, {
    status: result.status,
    statusText: result.statusText,
    headers,
  });
}

// Better Auth hardcodes `name: z.string()` in its sign-up body schema and offers no
// option to relax it, while our product only asks for email + password. We fill it in
// with the local part of the email before handing the request over to Better Auth.
app.post("/api/auth/sign-up/email", async (c) => {
  const db = createDatabase(c.env.makisend_db);
  const existingUsers = await db.select().from(user).limit(1);
  if (existingUsers.length > 0) {
    return c.json({ error: "Registration is closed" }, 403);
  }
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
  return addCorsHeaders(result, c.req.header("origin"));
});

app.all("/api/auth/*", async (c) => {
  const auth = getAuthInstance(c.env);
  const result = await auth.handler(c.req.raw);
  return addCorsHeaders(result, c.req.header("origin"));
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

// Initialize transport once a smtpConfig is available (for send-email)
app.use("*", async (c, next) => {
  if (!deps.transport) {
    const smtpConfig = c.get("smtpConfig");
    if (smtpConfig) {
      deps.initTransport(c.env, smtpConfig);
    }
  }
  await next();
});

// Mount send-email controller — getter resolves at request time
const sendEmailController = createSendEmailController(() => getInngestClient());
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

// Inngest webhook endpoint
app.on(
  ["GET", "PUT", "POST"],
  "/api/inngest",
  async (c) => {
    return serve({
      client: getInngestClient(),
      functions: getFunctions(),
    })(c);
  },
);

export default app;
