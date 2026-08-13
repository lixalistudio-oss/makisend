// --- Framework & core imports ---
import { Hono } from "hono";

// --- Middleware imports ---
import { errorHandler } from "@/middleware/error.handler";
import { requestLoggerMiddleware } from "@/middleware/request-logger.middleware";
import { apiKeyMiddleware } from "@/middleware/api-key.middleware";
import { configMiddleware } from "@/middleware/config.middleware";

// --- Module imports ---
import { createSendEmailController, SmtpEmailTransport } from "@/send-email";
import { inngest, functions, setInngestDeps } from "@/inngest/send-email";
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
// Dependencies are initialized once on first request, then reused.
// This avoids creating new connections on every Worker invocation.
const deps = {
  transport: null as IEmailTransport | null,   // SMTP transport (nodemailer)
  repository: null as IEmailRepository | null, // Database repository (D1/Drizzle)
  aesKey: null as string | null,               // AES encryption key

  // Initialize all dependencies once with env vars and SMTP config
  init(env: Bindings, smtpConfig: SmtpConfig) {
    if (this.transport) return; // Already initialized

    const db = createDatabase(env.makisend_db);
    this.repository = new SendEmailRepository(db);
    this.transport = new SmtpEmailTransport(
      { port: env.PORT, aesKey: env.AES_256_KEY, db: env.makisend_db, inngestConfig: env.INNGEST_DEV },
      smtpConfig,
    );
    this.aesKey = env.AES_256_KEY;

    // Inject dependencies into Inngest functions
    setInngestDeps(this.transport, this.repository, this.aesKey);
  },

  getTransport() {
    if (!this.transport) throw new Error("Deps not initialized");
    return this.transport;
  },

  getRepository() {
    if (!this.repository) throw new Error("Deps not initialized");
    return this.repository;
  },

  getAesKey() {
    if (!this.aesKey) throw new Error("Deps not initialized");
    return this.aesKey;
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
const sendEmailController = createSendEmailController();
app.route("/send-email", sendEmailController);

// Inngest webhook endpoint for function orchestration
app.on(
  ["GET", "PUT", "POST"],
  "/api/inngest",
  serve({
    client: inngest,
    functions,
  })
);

export default app;
