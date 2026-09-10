// --- Framework & core imports ---
import { Hono } from "hono";

// --- Middleware imports ---
import { errorHandler } from "@/middleware/error.handler";
import { requestLoggerMiddleware } from "@/middleware/request-logger.middleware";
import { configMiddleware } from "@/middleware/config.middleware";
import { apiKeyMiddleware } from "@/middleware/api-key.middleware";
import { sessionMiddleware } from "@/middleware/session.middleware";

// --- Module imports ---
import { createSendEmailController, SmtpEmailTransport } from "@/send-email";
import { createSmtpConfigController, SmtpConfigRepository } from "@/smtp-config";
import { createApiKeysController, ApiKeyRepository } from "@/api-keys";
import { configureDeps, getInngestClient } from "@/inngest/client";
import { getFunctions } from "@/inngest/functions";
import { serve } from "inngest/hono";

// --- Better Auth ---
import { createAuth } from "@/lib/auth";

// --- Database & repository imports ---
import { createDatabase } from "@/db/connection";
import { SendEmailRepository } from "@/send-email/send-email.repository";

// --- Type imports ---
import type { SmtpConfig, UserConfig } from "./config/config";
import type { IEmailTransport, IEmailRepository } from "@/send-email/send-email.types";
import type { ISmtpConfigRepository } from "@/smtp-config/smtp-config.types";
import type { IApiKeyRepository } from "@/api-keys/api-keys.types";

// --- Cloudflare Worker environment bindings ---
export type Bindings = {
  AES_256_KEY: string;
  makisend_db: D1Database;
  PORT: number;
  INNGEST_DEV: number;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
};

// --- Hono context variables (per-request) ---
export type UserInfoVariables = {
  userConfig: UserConfig;
  smtpConfig: SmtpConfig;
  userId: string;
};

// Singleton: auth created once on first request, reused after
let authInstance: ReturnType<typeof createAuth> | null = null;

function getAuthInstance(env: Bindings) {
  if (!authInstance) {
    authInstance = createAuth(env);
  }
  return authInstance;
}

// --- Lazy dependency container ---
const deps = {
  transport: null as IEmailTransport | null,
  emailRepository: null as IEmailRepository | null,
  smtpConfigRepository: null as ISmtpConfigRepository | null,
  apiKeyRepository: null as IApiKeyRepository | null,
  aesKey: null as string | null,
  dbInitialized: false,

  initDb(env: Bindings) {
    if (this.dbInitialized) return;

    const db = createDatabase(env.makisend_db);
    const auth = getAuthInstance(env);
    this.emailRepository = new SendEmailRepository(db);
    this.smtpConfigRepository = new SmtpConfigRepository(db);
    this.apiKeyRepository = new ApiKeyRepository(db, auth);
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
};

// --- Hono app setup ---
const app = new Hono<{ Bindings: Bindings; Variables: UserInfoVariables }>();

// Global middleware: request logging, error handling, config injection
app.use("*", requestLoggerMiddleware());
app.onError(errorHandler);
app.use(configMiddleware());

// Better Auth endpoints (sign-up, sign-in, sign-out, get-session)
app.post("/api/auth/sign-up", async (c) => {
  const auth = getAuthInstance(c.env);
  const body = await c.req.json();
  const result = await auth.api.signUpEmail({
    body: {
      email: body.email,
      password: body.password,
      name: body.name,
    },
    asResponse: true,
  });
  return result;
});

app.post("/api/auth/sign-in", async (c) => {
  const auth = getAuthInstance(c.env);
  const body = await c.req.json();
  const result = await auth.api.signInEmail({
    body: {
      email: body.email,
      password: body.password,
    },
    asResponse: true,
  });
  return result;
});

app.get("/api/auth/get-session", async (c) => {
  const auth = getAuthInstance(c.env);
  const result = await auth.api.getSession({
    headers: c.req.raw.headers,
    asResponse: true,
  });
  return result;
});

app.post("/api/auth/sign-out", async (c) => {
  const auth = getAuthInstance(c.env);
  const result = await auth.api.signOut({
    headers: c.req.raw.headers,
    asResponse: true,
  });
  return result;
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
  () => deps.smtpConfigRepository!,
  () => deps.aesKey!,
  () => deps.apiKeyRepository!,
);
app.use("/smtp-config/*", async (c, next) => {
  const auth = getAuthInstance(c.env);
  await sessionMiddleware(auth)(c, next);
});
app.route("/smtp-config", smtpConfigController);

// Mount API keys controller with session auth
const apiKeysController = createApiKeysController(
  () => deps.apiKeyRepository!,
);
app.use("/api-keys/*", async (c, next) => {
  const auth = getAuthInstance(c.env);
  await sessionMiddleware(auth)(c, next);
});
app.route("/api-keys", apiKeysController);

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
