// --- Framework & core imports ---
import { Hono } from "hono";

// --- Middleware imports ---
import { errorHandler } from "@/middleware/error.handler";
import { requestLoggerMiddleware } from "@/middleware/request-logger.middleware";
import { apiKeyMiddleware } from "@/middleware/api-key.middleware";
import { configMiddleware } from "@/middleware/config.middleware";

// --- Module imports ---
import { createSendEmailController, SmtpEmailTransport } from "@/send-email";
import { createInngestModule } from "@/inngest/send-email";
import { serve } from "inngest/hono";

// --- Database & repository imports ---
import { createDatabase } from "@/db/connection";
import { SendEmailRepository } from "@/send-email/send-email.repository";

// --- Type imports ---
import type { SmtpConfig, UserConfig } from "./config/config";
import type { IEmailTransport, IEmailRepository } from "@/send-email/send-email.types";

// --- Cloudflare Worker environment bindings ---
export type Bindings = {
  AES_256_KEY: string;          // AES-256 key for email encryption
  makisend_db: D1Database;      // Cloudflare D1 database binding
  PORT: number;                 // SMTP port
  INNGEST_DEV: number;          // Inngest dev mode flag
  HOST: string;                 // SMTP host
  SMTP_USER: string;            // SMTP username
  SMTP_PASSWORD: string;        // SMTP password
  SENDER_EMAIL: string;         // Sender email address
  USER_ID?: string;             // Optional user ID
};

// --- Hono context variables (per-request) ---
export type UserInfoVariables = {
  userConfig: UserConfig;       // User config (userId, etc.)
  smtpConfig: SmtpConfig;       // SMTP connection config
};

// --- Lazy dependency container ---
const deps = {
  transport: null as IEmailTransport | null,
  repository: null as IEmailRepository | null,
  aesKey: null as string | null,
  inngest: null as ReturnType<typeof createInngestModule> | null,

  init(env: Bindings, smtpConfig: SmtpConfig) {
    if (this.transport) return;

    const db = createDatabase(env.makisend_db);
    this.repository = new SendEmailRepository(db);
    this.transport = new SmtpEmailTransport(
      { port: env.PORT, aesKey: env.AES_256_KEY, db: env.makisend_db, inngestConfig: env.INNGEST_DEV },
      smtpConfig,
    );
    this.aesKey = env.AES_256_KEY;

    this.inngest = createInngestModule(this.transport, this.repository, this.aesKey);
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

// API key auth middleware for send-email routes
app.use("/send-email/*", async (c, next) => {
  const config = c.get("appConfig");
  await apiKeyMiddleware(config)(c, next);
});

// Mount send-email controller at /send-email
// The controller receives a lazy getter for inngest — resolved at request time, not module load time
const sendEmailController = createSendEmailController(() => {
  if (!deps.inngest) throw new Error("Inngest module not initialized");
  return deps.inngest.client;
});
app.route("/send-email", sendEmailController);

// Inngest webhook endpoint for function orchestration
app.on(
  ["GET", "PUT", "POST"],
  "/api/inngest",
  async (c) => {
    if (!deps.inngest) {
      throw new Error("Inngest module not initialized");
    }
    return serve({
      client: deps.inngest.client,
      functions: deps.inngest.functions,
    })(c);
  }
);

export default app;
