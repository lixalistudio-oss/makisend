// --- Framework & core imports ---
import { Hono } from "hono";

// --- Middleware imports ---
import { errorHandler } from "@/middleware/error.handler";
import { requestLoggerMiddleware } from "@/middleware/request-logger.middleware";
import { configMiddleware } from "@/middleware/config.middleware";

// --- Module imports ---
import { createSendEmailController, SmtpEmailTransport } from "@/send-email";
import { configureDeps, getInngestClient, getFunctions } from "@/inngest/send-email";
import { serve } from "inngest/hono";

// --- Database & repository imports ---
import { createDatabase } from "@/db/connection";
import { SendEmailRepository } from "@/send-email/send-email.repository";

// --- Type imports ---
import type { SmtpConfig } from "./config/config";
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
};

// --- Hono context variables (per-request) ---
export type UserInfoVariables = {
  smtpConfig: SmtpConfig;
};

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
      { port: env.PORT, aesKey: env.AES_256_KEY, db: env.makisend_db, inngestConfig: env.INNGEST_DEV },
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

// Initialize lazy dependencies on first request (if not already done)
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
  }
);

export default app;
