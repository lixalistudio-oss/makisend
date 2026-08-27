// --- Framework & core imports ---
import { Hono } from "hono";

// --- Middleware imports ---
import { errorHandler } from "@/middleware/error.handler";
import { requestLoggerMiddleware } from "@/middleware/request-logger.middleware";
import { configMiddleware } from "@/middleware/config.middleware";
import { apiKeyMiddleware } from "@/middleware/api-key.middleware";

// --- Module imports ---
import { createSendEmailController, SmtpEmailTransport } from "@/send-email";
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

// --- Cloudflare Worker environment bindings ---
export type Bindings = {
  AES_256_KEY: string;
  makisend_db: D1Database;
  PORT: number;
  INNGEST_DEV: number;
  HOST: string;
  SMTP_USER: string;
  SMTP_PASSWORD: string;
  SENDER_EMAIL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
};

// --- Hono context variables (per-request) ---
export type UserInfoVariables = {
  userConfig: UserConfig;
  smtpConfig: SmtpConfig;
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
  repository: null as IEmailRepository | null,
  aesKey: null as string | null,

  init(env: Bindings, smtpConfig: SmtpConfig) {
    if (this.transport) return;

    const db = createDatabase(env.makisend_db);
    this.repository = new SendEmailRepository(db);
    this.transport = new SmtpEmailTransport(
      { port: env.PORT, aesKey: env.AES_256_KEY, db: env.makisend_db, inngestConfig: env.INNGEST_DEV ,better_auth_secret: env.BETTER_AUTH_SECRET,better_auth_url: env.BETTER_AUTH_URL},
      smtpConfig,
    );
    this.aesKey = env.AES_256_KEY;

    configureDeps(this.transport, this.repository, this.aesKey);
  },
};

// --- Hono app setup ---
const app = new Hono<{ Bindings: Bindings; Variables: UserInfoVariables }>();

// Global middleware: request logging, error handling, config injection
app.use("*", requestLoggerMiddleware());
app.onError(errorHandler);
app.use(configMiddleware());

// API key auth (Better Auth) on send-email routes
app.use("/send-email/*", async (c, next) => {
  const config = c.get("appConfig");
  const auth = getAuthInstance(c.env);
  await apiKeyMiddleware(config, auth)(c, next);
});

// Initialize lazy dependencies once a smtpConfig is available
app.use("*", async (c, next) => {
  if (!deps.transport) {
    const smtpConfig = c.get("smtpConfig");
    if (smtpConfig) {
      deps.init(c.env, smtpConfig);
    }
  }
  await next();
});

// Mount send-email controller — getter resolves at request time
const sendEmailController = createSendEmailController(() => getInngestClient());
app.route("/send-email", sendEmailController);

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
