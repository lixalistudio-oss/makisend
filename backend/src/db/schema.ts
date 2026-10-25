import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createId } from "@paralleldrive/cuid2";
import { relations, sql } from "drizzle-orm";


export const emailLogs = sqliteTable("email_logs", {
  internalId: text("internalId").primaryKey().$defaultFn(() => createId()),
  userId : text("user_id").notNull(),
  // SET NULL: deleting an API key keeps the send history but unhooks it, so
  // keys (and SMTP configs via cascade) can always be deleted.
  apiKeyId: text("apikey_id").references(() => apikey.id, { onDelete: "set null" }),
  to: text("to").notNull(),
  subject: text("subject").notNull(),
  // Nullable: written at enqueue as a pending row, filled in when (and if) the
  // email is actually delivered. Failed sends keep smtp_id/sent_at as NULL.
  smtpId: text("smtp_id"),
  sentAt: text("sent_at"),
  emailProcessingTimeMs: integer("email_processing_time"),
  // "api": sent through POST /send-email. "test": the dashboard's manual test send. Tests are listed
  // in the logs but never counted in the dashboard's totals and success rate, which describe API traffic.
  source: text("source", { enum: ["api", "test"] }).notNull().default("api"),
  // The configuration a test went through. Not a foreign key, like email_contents: deleting a
  // configuration keeps the history. NULL for API sends, whose configuration is their key's.
  smtpConfigId: text("smtp_config_id"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
},
  (table) => [
    // Every dashboard query filters on user_id (+ optional created_at window);
    // without this the whole table is scanned on each load.
    index("emailLogs_userId_createdAt_idx").on(table.userId, table.createdAt),
    index("emailLogs_apiKeyId_idx").on(table.apiKeyId),
  ],
);

// Better Auth rate limiter storage (model "rateLimit"). In-memory storage would be
// per-isolate on Workers, i.e. no limit at all, so the counters live in D1.
export const rateLimit = sqliteTable("rate_limit", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: integer("last_request").notNull(),
});

// Message bodies live in their own table so dashboard queries on email_logs
// never read them. text/html are AES-GCM encrypted (hex, ~2x their size) — the
// DTO caps keep a row well under D1's 2 MB limit. Deleting an email_logs row
// (e.g. account deletion) deletes its content with it.
export const emailContents = sqliteTable("email_contents", {
  emailId: text("email_id")
    .primaryKey()
    .references(() => emailLogs.internalId, { onDelete: "cascade" }),
  textBody: text("text_body").notNull(),
  htmlBody: text("html_body").notNull(),
  // No FK: deleting an SMTP config must not erase the content of emails already
  // queued with it; sending then fails with a permanent "config not found".
  smtpConfigId: text("smtp_config_id"),
  // POST /send-email `reply_to` (an address) and `headers` (a JSON object), both AES-GCM
  // encrypted like the bodies. NULL when the caller did not set them.
  replyTo: text("reply_to"),
  headers: text("headers"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// Attachments of an email (POST /send-email `attachments`), one row each so a row stays under
// D1's 2 MB limit. `content` is the file as base64, then AES-GCM encrypted (hex, ~2.7x the raw
// size: the DTO caps a file at 512 KB). Read back only by the send-email workflow, like the
// bodies; deleting the email_logs row deletes them with it.
export const emailAttachments = sqliteTable(
  "email_attachments",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    emailId: text("email_id")
      .notNull()
      .references(() => emailLogs.internalId, { onDelete: "cascade" }),
    // The order the caller sent them in.
    position: integer("position").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    content: text("content").notNull(),
    createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  },
  (table) => [uniqueIndex("emailAttachments_emailId_position_unique").on(table.emailId, table.position)],
);

// HTTP idempotency for POST /send-email. A row is reserved before the handler
// runs and filled with the response afterwards, so a client retry with the same
// Idempotency-Key replays the original emailId instead of sending twice.
export const idempotencyKeys = sqliteTable(
  "idempotency_keys",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    userId: text("user_id").notNull(),
    route: text("route").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    // NULL while the first request is still running.
    statusCode: integer("status_code"),
    responseBody: text("response_body"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("idempotencyKeys_userId_route_key_unique").on(
      table.userId,
      table.route,
      table.key,
    ),
    index("idempotencyKeys_expiresAt_idx").on(table.expiresAt),
  ],
);

export const emailHistories = sqliteTable("email_histories", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  emailId: text("email_id").notNull(),
  status: text("status").notNull(),
  error: text("error"),
  attempts: integer("attempts"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
},
  (table) => [
    // Status lookups are always "history rows for this email, newest first".
    index("emailHistories_emailId_createdAt_idx").on(table.emailId, table.createdAt),
  ],
);

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .default(false)
    .notNull(),
  image: text("image"),
  // Better Auth two-factor plugin.
  twoFactorEnabled: integer("two_factor_enabled", { mode: "boolean" }).default(false),
  // Opt-in, set from Settings with the password: lets the account sign in with email + an
  // authenticator code, without the password (src/lib/totp-sign-in.ts).
  totpPasswordless: integer("totp_passwordless", { mode: "boolean" }).default(false).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

/**
 * Single-row lock (id = 1) that makes the first sign-up the only one: MakiSend has one
 * account, its super admin, created at the first connection. Every user-creation path goes
 * through `databaseHooks.user.create.before` (src/lib/auth.ts), which claims this row
 * atomically (src/lib/owner-lock.ts). Deleting the account releases it.
 */
export const instanceOwner = sqliteTable("instance_owner", {
  id: integer("id").primaryKey(),
  claimedAt: integer("claimed_at").notNull(),
});

/** Better Auth two-factor plugin (model "twoFactor"): one row per user, TOTP secret and backup codes encrypted. */
export const twoFactor = sqliteTable(
  "two_factor",
  {
    id: text("id").primaryKey(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    verified: integer("verified", { mode: "boolean" }).default(true),
    failedVerificationCount: integer("failed_verification_count").default(0),
    lockedUntil: integer("locked_until", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("twoFactor_secret_idx").on(table.secret),
    index("twoFactor_userId_idx").on(table.userId),
  ],
);

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp_ms",
    }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp_ms",
    }),
    scope: text("scope"),
    password: text("password"),
    issuer: text("issuer"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const smtpConfig = sqliteTable(
  "smtp_config",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    smtpHostname: text("smtphostname").notNull(),
    // Submission port and TLS mode belong to the configuration: providers differ,
    // and a Worker cannot use port 25. Defaults preserve the old implicit-TLS/465
    // behaviour for rows created before these columns existed.
    smtpPort: integer("smtp_port").default(465).notNull(),
    smtpSecurity: text("smtp_security", { enum: ["tls", "starttls"] })
      .default("tls")
      .notNull(),
    smtpUsername: text("smtpusername").notNull(),
    smtpPassword: text("smtppassword").notNull(),
    senderEmail: text("sender_email").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).default(true),
    // Written by the scheduled SMTP health check; null until the first run.
    lastCheckAt: integer("last_check_at", { mode: "timestamp_ms" }),
    lastCheckOk: integer("last_check_ok", { mode: "boolean" }),
    lastCheckError: text("last_check_error"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("smtpConfig_userId_idx").on(table.userId)],
);

// User-defined email templates: subject/html/text may contain {{variable}}
// placeholders that are replaced at send time (POST /send-email with templateId).
export const templates = sqliteTable(
  "templates",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    subject: text("subject").notNull(),
    // "legacy" templates are edited as raw HTML. "react-email" templates keep
    // their TipTap document in editor_json and are rendered by the dashboard.
    // "react-email-code" templates keep pasted TSX in source; the dashboard
    // transpiles/renders it in the browser and stores the resulting html/text.
    format: text("format", { enum: ["legacy", "react-email", "react-email-code"] })
      .default("legacy")
      .notNull(),
    editorJson: text("editor_json"),
    source: text("source"),
    html: text("html").notNull(),
    text: text("text").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("templates_userId_idx").on(table.userId)],
);

export const apikey = sqliteTable(
  "apikey",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    configId: text("config_id").default("default").notNull(),
    name: text("name"),
    start: text("start"),
    referenceId: text("reference_id").notNull(),
    prefix: text("prefix"),
    key: text("key").notNull(),
    refillInterval: integer("refill_interval"),
    refillAmount: integer("refill_amount"),
    lastRefillAt: integer("last_refill_at", { mode: "timestamp_ms" }),
    enabled: integer("enabled", { mode: "boolean" }).default(true),
    rateLimitEnabled: integer("rate_limit_enabled", {
      mode: "boolean",
    }).default(true),
    rateLimitTimeWindow: integer("rate_limit_time_window").default(86400000),
    rateLimitMax: integer("rate_limit_max").default(10000),
    requestCount: integer("request_count").default(0),
    remaining: integer("remaining"),
    lastRequest: integer("last_request", { mode: "timestamp_ms" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    permissions: text("permissions"),
    metadata: text("metadata"),
    // Not unique: one SMTP config can be shared by many API keys.
    smtpConfigId: text("smtp_config_id").references(() => smtpConfig.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("apikey_smtpConfigId_idx").on(table.smtpConfigId),
    index("apikey_configId_idx").on(table.configId),
    index("apikey_referenceId_idx").on(table.referenceId),
    index("apikey_key_idx").on(table.key),
  ],
);

// Optional per-key send quota (SEND_RATE_LIMIT, off by default). One row per API key:
// a fixed window that restarts once `window_start + window` has passed. Deleting the key
// deletes its counter.
export const sendRateLimit = sqliteTable("send_rate_limit", {
  apiKeyId: text("api_key_id")
    .primaryKey()
    .references(() => apikey.id, { onDelete: "cascade" }),
  windowStart: integer("window_start").notNull(),
  count: integer("count").notNull(),
});

// Addresses POST /send-email refuses to send to (src/suppressions): added when an SMTP server
// rejects the recipient as non-existent, or by hand from the dashboard. `recipient` is AES-GCM
// encrypted; `recipient_hash` is a keyed HMAC of the lower-cased address (core/crypto
// keyedHash) so a send can be checked without decrypting the table, and `hash_kid` is the key
// it was computed with (re-hashed by the key-rotation job). Deleting the user deletes the list.
export const suppressions = sqliteTable(
  "suppressions",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    recipient: text("recipient").notNull(),
    recipientHash: text("recipient_hash").notNull(),
    hashKid: text("hash_kid").notNull(),
    // "bounce": rejected by the recipient's server. "manual": added from the dashboard.
    source: text("source", { enum: ["bounce", "manual"] }).notNull(),
    reason: text("reason").notNull(),
    // The send that bounced. Not a foreign key: deleting logs keeps the suppression.
    emailId: text("email_id"),
    createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    uniqueIndex("suppressions_userId_recipientHash_unique").on(table.userId, table.recipientHash),
    index("suppressions_hashKid_idx").on(table.hashKid),
  ],
);

// Result of the last "is a newer MakiSend release published?" check (src/updates). A single
// row (id = "latest"): the daily cron or the dashboard overwrites it. Only the latest
// release is stored; whether it is newer is decided at read time against the running build.
export const updateCheck = sqliteTable("update_check", {
  id: text("id").primaryKey(),
  latestVersion: text("latest_version"),
  releaseName: text("release_name"),
  releaseUrl: text("release_url"),
  releaseNotes: text("release_notes"),
  publishedAt: text("published_at"),
  checkedAt: integer("checked_at").notNull(),
  error: text("error"),
});

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  smtpConfigs: many(smtpConfig),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const smtpConfigRelations = relations(smtpConfig, ({ one }) => ({
  user: one(user, {
    fields: [smtpConfig.userId],
    references: [user.id],
  }),
}));
