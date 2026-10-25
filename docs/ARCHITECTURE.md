# MakiSend — End-to-End Architecture

> **Status:** POC. This document describes the code on the `dev` branch and
> calls out known gaps explicitly. It is not a specification of the target
> product.
>
> **Audience:** engineers, reviewers and future maintainers who need to
> understand how a request becomes a delivered email, and where the sharp edges
> are.
>
> **Maintenance note:** parts of this document predate the current delivery
> pipeline and dashboard. Treat `AGENTS.md`, `README.md`,
> `/dashboard/api-docs`, and `/openapi.json` as the current reference until
> this document is fully refreshed.

---

## 1. What MakiSend is

MakiSend is a serverless transactional-email API deployed as a single
Cloudflare Worker. It exists to answer three questions:

1. Can a backend that uses **nodemailer + raw SMTP** run on Cloudflare Workers?
2. Can it work at scale?
3. Can emails land in the inbox instead of spam?

The POC deliberately keeps the product surface small: authenticate with an API
key, accept an email (inline HTML/text or a stored template), persist a pending
log, enqueue the work, and deliver it asynchronously through a durable workflow.
A small Astro dashboard (served by the same Worker) manages SMTP credentials,
API keys, templates and delivery logs.

**Non-goals in the current code:** multi-tenant sign-up, billing, scopes,
outgoing webhooks, open/click tracking, multi-provider failover, deliverability
automation (SPF/DKIM/DMARC), and rate limiting at the edge.

---

## 2. System context

```
┌──────────────────────────┐        ┌───────────────────────────────┐
│ API client (server-side) │        │ Browser (Astro dashboard)     │
│ x-api-key / Bearer       │        │ Better Auth session cookie    │
└────────────┬─────────────┘        └──────────────┬────────────────┘
             │                                     │
             └──────────────────┬──────────────────┘
                                ▼
                 Cloudflare Worker `makisend-poc`
        ┌─────────────────────────────────────────────────────┐
        │ Static Assets binding (frontend/dist)               │
        │ Hono app                                            │
        │  /api/auth/*      → Better Auth (D1)                │
        │  /send-email      → API-key auth → D1 → Queue       │
        │  /smtp-config     → session auth → D1               │
        │  /api-keys        → session auth → D1 (Better Auth) │
        │  /templates       → session auth → D1               │
        │  /email-logs      → session auth → D1               │
        │  /dashboard/*     → session auth → D1               │
        │  queue()          → Workflows.create()              │
        └───────────┬───────────────────────┬─────────────────┘
                    │                       │
                    ▼                       ▼
          Cloudflare D1              Cloudflare Queue
          `makisend_db`              `makisend-send-email`
          (SQLite)                   + DLQ
                                            │
                                            ▼
                              Cloudflare Workflow instance
                              `makisend-send-email`
                              (SendEmailWorkflow)
                                            │
                                            ▼
                              nodemailer → SMTP provider
                              (implicit TLS, port 465 by default)
```

There is no separate frontend deployment and no CORS boundary in production:
the Worker serves both `frontend/dist` and the API on the same origin. The
Astro dev server (port 4321) proxies API paths to Wrangler (port 8787) during
local development.

---

## 3. Runtime topology and bindings

The Worker entrypoint is `backend/src/index.ts`. It exports:

- `app` — the Hono application (also used by tests via `app.request(...)`).
- `SendEmailWorkflow` — required so Wrangler can resolve the workflow
  `class_name`.
- a default object with `fetch: app.fetch` and `queue: sendEmailQueueConsumer`.

### 3.1 Bindings

| Binding | Type | Source | Purpose |
|---|---|---|---|
| `AES_256_KEY` | secret | Wrangler secret / `.dev.vars` | 64 hex chars; AES-256-GCM key for recipient + SMTP fields |
| `BETTER_AUTH_SECRET` | secret | Wrangler secret / `.dev.vars` | Better Auth signing secret |
| `BETTER_AUTH_URL` | secret | Wrangler secret / `.dev.vars` | Worker base URL used by Better Auth |
| `FRONTEND_URL` | secret | Wrangler secret / `.dev.vars` | Trusted origin for Better Auth / redirects |
| `PORT` | var | `wrangler.jsonc` (`"465"`) | SMTP port passed to nodemailer |
| `makisend_db` | D1 | `wrangler.jsonc` | Application database |
| `SEND_EMAIL_QUEUE` | Queue producer | `wrangler.jsonc` | Buffers send requests |
| `SEND_EMAIL_WORKFLOW` | Workflow binding | `wrangler.jsonc` | Starts durable runs |
| `ASSETS` | Fetcher | `wrangler.jsonc` | Static frontend served before the Worker script |

`Bindings` is declared in `backend/src/index.ts:39`. `worker-configuration.d.ts`
is generated by Wrangler and is currently stale/tracked; do not treat it as the
source of truth — run `pnpm cf-typegen` (see the developer guide).

### 3.2 Cloudflare resources

`backend/wrangler.jsonc`:

- Worker name `makisend-poc`, compatibility date `2026-07-10`,
  `nodejs_compat`.
- D1 database `makisend-db`, binding `makisend_db`, migrations in `./drizzle`.
- Queue producer/consumer `makisend-send-email`, DLQ
  `makisend-send-email-dlq`, `max_batch_size: 10`, `max_batch_timeout: 5`,
  `max_retries: 3`, `retry_delay: 30`.
- Workflow `makisend-send-email`, binding `SEND_EMAIL_WORKFLOW`, class
  `SendEmailWorkflow`.
- `env.preview` duplicates all of this with `-preview` names and its own D1.

---

## 4. Repository layout

```
makisend-poc/
├── backend/                  # Cloudflare Worker (package `makisend-poc`)
│   ├── src/
│   │   ├── index.ts          # Bindings, middleware order, DI, routes, exports
│   │   ├── api-keys/         # Per-user API key CRUD (Better Auth)
│   │   ├── config/           # Bindings → typed Config
│   │   ├── core/             # AppError, Pino, AES-GCM, sanitizer, bootstrap
│   │   ├── dashboard/        # Aggregated delivery metrics
│   │   ├── db/               # Drizzle schema + D1 factory
│   │   ├── email-logs/       # Log listing + history
│   │   ├── lib/auth.ts       # Better Auth instance
│   │   ├── middleware/       # API key, session, config, errors, logging
│   │   ├── queue/            # Queue consumer → workflow
│   │   ├── send-email/       # HTTP → queue orchestration + SMTP transport
│   │   ├── smtp-config/      # Encrypted per-user SMTP credentials
│   │   ├── templates/        # Template CRUD + visual-editor content + renderer
│   │   └── workflows/        # Durable SendEmailWorkflow
│   ├── drizzle/              # SQL migrations + meta snapshots
│   ├── test/                 # Vitest unit + Miniflare D1 integration tests
│   ├── wrangler.jsonc
│   └── .env.example
├── frontend/                 # Astro + React dashboard (package `frontend`)
│   ├── src/pages/            # /, /login, /register, /dashboard/*
│   ├── src/components/       # React islands (layouts, tables, forms)
│   ├── src/lib/api.ts        # Same-origin fetch helper
│   └── astro.config.mjs      # Dev proxy to the Worker
├── docs/                     # This documentation
├── Dockerfile / docker-compose.yml
└── .github/workflows/        # CI (lint + tests) and Deploy
```

The backend follows a **NestJS-inspired module pattern**:

- **Controller** — HTTP only: validation, context reads, response shaping.
- **Service** — business rules, ownership checks, orchestration.
- **Repository** — Drizzle/D1 persistence behind an interface.
- **DTO** — Zod schemas + inferred types.
- **Barrel `index.ts`** — module public surface.

`send-email` is the exception: it has no service layer. The controller talks to
the repository and the queue directly, and the workflow owns the delivery
orchestration.

---

## 5. Request lifecycle

### 5.1 Middleware order (`backend/src/index.ts`)

1. **CORS** — `origin: (origin) => origin`, `credentials: true`,
   `allowHeaders: ["Content-Type", "Authorization"]`, methods
   GET/POST/PUT/DELETE/OPTIONS (`index.ts:128`).
2. **Request logger** — logs method, URL, status and duration through Pino
   (`middleware/request-logger.middleware.ts`).
3. **Global error handler** — registered with `app.onError(errorHandler)`.
4. **Config middleware** — `createConfig(c.env)` validates `AES_256_KEY`
   (64 hex chars) and `makisend_db`, then stores the typed `Config` in
   `c.get("appConfig")` (`middleware/config.middleware.ts`,
   `config/config.ts`).
5. **Better Auth routes** — `POST /api/auth/sign-up/email` is special-cased
   (see §6.1); every other `/api/auth/*` request is forwarded raw to
   `auth.handler()`. CORS headers are re-applied to the raw response because
   Hono middleware cannot inject them into a Response returned by Better Auth.
6. **API-key middleware** — only `/send-email/*`; verifies the key and loads
   the caller's user + SMTP configuration.
7. **Lazy dependency initialization** — on the first request, builds the
   Drizzle DB and every repository/service singleton (`deps` object,
   `index.ts:81`).
8. **Route controllers** — mounted in this order: `/send-email`,
   `/smtp-config`, `/api-keys`, `/email-logs`, `/dashboard`, `/templates`.
   Dashboard routes are wrapped in `sessionMiddleware`.
9. **Error handler** — `AppError` returns its status code and message; any
   other error returns `500` with `error.message` (or `"Internal Server Error"`).

Note that the lazy initializer is registered *after* the `/send-email`
middleware but before the controllers, so it runs for every request that
reaches a controller.

### 5.2 Dependency injection

There is no IoC container. `deps` is a module-level object holding nullable
repositories/services and two idempotent initializers:

- `initDb(env)` — `createDatabase(env.makisend_db)`, constructs repositories,
  caches `env.AES_256_KEY`, sets `dbInitialized`.
- `initServices()` — constructs services with repositories + AES key.

Controllers receive **getter functions** (`() => deps.emailRepository!`) so
they resolve the singleton at request time, not at module load. The auth
instance is cached separately and recreated when `BETTER_AUTH_URL` or
`FRONTEND_URL` changes (`getAuthInstance`, `index.ts:67`).

This is request-safe in Workers because module state is per-isolate, but it
means a change to `AES_256_KEY` or the DB binding without a redeploy will not
be picked up by an already-warm isolate. It also means the auth cache key does
not include `BETTER_AUTH_SECRET`.

---

## 6. Authentication and authorization

MakiSend has two independent auth planes.

### 6.1 Dashboard session auth (Better Auth)

`backend/src/lib/auth.ts` configures Better Auth with:

- Drizzle adapter (`provider: "sqlite"`, `transaction: false`).
- Email/password enabled.
- `changeEmail.updateEmailWithoutVerification: true` (no verification flow is
  configured, so the settings page can change the email immediately).
- `deleteUser.beforeDelete` deletes `email_logs` for the user before Better
  Auth removes the user. This is required because `email_logs.userId` has no
  FK to `user` and would otherwise block the `user → smtp_config → apikey`
  cascade.
- `trustedOrigins: [FRONTEND_URL]`.
- Cookie defaults `SameSite=None; Secure` (Workers and Pages are different
  sites in a split deployment; the current same-origin deployment still uses
  this).
- API-key plugin: prefix `mk_`, rate limit 10,000 requests/day per key.

Sign-up is **closed after the first user**. The special route at
`index.ts:158` counts rows in `user`; if any exists it returns
`403 {"error":"Registration is closed"}`. Otherwise it injects a `name` (the
local part of the email) because Better Auth requires one while the product UI
only asks for email + password, then forwards the request to
`auth.handler()`.

`sessionMiddleware` calls `auth.api.getSession({ headers })`, rejects with
`401 Unauthorized` when there is no session, and sets `c.get("userId")`.

### 6.2 API-key auth (machine clients)

`apiKeyMiddleware` (`middleware/api-key.middleware.ts`):

1. Reads `x-api-key`, or `Authorization: Bearer <key>`.
2. Missing → `401`; invalid → `403`.
3. Calls `auth.api.verifyApiKey({ body: { key } })`.
4. `result.key.referenceId` is the owning user id; loads the user.
5. Loads `apikey.smtpConfigId` and the referenced `smtp_config` row.
6. Decrypts the four SMTP fields and sets them in context, along with
   `userId`, `apiKeyId`, `smtpConfigId`.

Each API key is linked to exactly one SMTP configuration (`apikey.smtpConfigId`
is `UNIQUE`), and deleting that configuration cascades to the key. An API key
with no linked config is rejected with `403 "API key has no SMTP configuration"`.

The decrypted credentials placed in context are **not used** by the send-email
controller; it only forwards `smtpConfigId` and the workflow re-resolves and
decrypts the config. The middleware decryption is therefore redundant today.

### 6.3 Ownership rules

- SMTP config, template and API-key CRUD are scoped to the session `userId`.
  Cross-user access returns `403` for CRUD, except `templateId` at send time
  which returns `404` to avoid probing template existence.
- `POST /send-email` derives `userId` and `smtpConfigId` from the API key, not
  from the body (the body is `.strict()` and has no such fields).
- `email_logs` reads are filtered by `userId`.

---

## 7. Data model

Schema: `backend/src/db/schema.ts`. Migrations: `backend/drizzle/*.sql`
(generated by `drizzle-kit generate`).

### 7.1 Tables

| Table | Key columns | Notes |
|---|---|---|
| `user` | `id` PK, `email` unique, `name`, `emailVerified`, timestamps | Better Auth |
| `session` | `id` PK, `token` unique, `userId` FK cascade, `expiresAt` | Better Auth |
| `account` | `id` PK, `userId` FK cascade, `providerId`, `password` | Better Auth password hash |
| `verification` | `id` PK, `identifier`, `value`, `expiresAt` | Better Auth |
| `smtp_config` | `id` PK, `userId` FK cascade, encrypted `smtphostname`, `smtpusername`, `smtppassword`, `sender_email`, `isActive` | One row per SMTP account |
| `apikey` | Better Auth columns + `referenceId` (= user id), `key` (hashed by Better Auth), `prefix`, `smtpConfigId` unique FK cascade | One key ↔ one SMTP config |
| `templates` | `id` PK, `userId` FK cascade, `name`, `subject`, `format` (`legacy`/`react-email`/`react-email-code`), nullable `editorJson`/`source`, `html`, `text` | Plaintext content with `{{variables}}`; `editorJson` is the builder envelope (theme + TipTap content), `source` is pasted TSX |
| `email_logs` | `internalId` PK (cuid2), `userId`, `apiKeyId` FK set null, `to` encrypted, `subject`, nullable `smtpId`/`sentAt`, `emailProcessingTimeMs`, `createdAt` ISO text | Pending row created at enqueue |
| `email_histories` | `id` PK, `emailId` (no FK), `status`, `error`, `attempts`, `createdAt` | Append-only timeline |

Indexes:

- `email_logs(userId, createdAt)` and `email_logs(apiKeyId)`.
- `email_histories(emailId, createdAt)`.
- `smtp_config(userId)`, `templates(userId)`, `apikey(configId)`,
  `apikey(referenceId)`, `apikey(key)`.
- Better Auth indexes on `session(userId)`, `account(userId)`,
  `verification(identifier)`.

### 7.2 Relationships and deletion behavior

```
user 1 ──< session
user 1 ──< account
user 1 ──< smtp_config 1 ──< apikey (smtpConfigId UNIQUE)
user 1 ──< templates
user 1 ──< email_logs (userId is a plain column, no FK)
apikey 1 ──< email_logs (apiKeyId, ON DELETE SET NULL)
email_logs 1 ──< email_histories (emailId, no FK)
```

Consequences:

- Deleting an SMTP config cascades to its API key; `email_logs.apiKeyId`
  becomes `NULL`, so the logs survive but lose the config link.
- Deleting a user: Better Auth's `beforeDelete` purges `email_logs`; the
  cascade removes sessions, accounts, SMTP configs, API keys and templates.
  `email_histories` rows are **not** deleted because they have no FK — they
  become orphans.
- `email_logs` rows can exist without an API key or SMTP config.

### 7.3 Encryption

`backend/src/core/crypto.ts`:

- AES-256-GCM via Web Crypto.
- Key: 64 hexadecimal characters (`openssl rand -hex 32`).
- Ciphertext format: `JSON.stringify({ iv: "<hex>", data: "<hex>" })`.
- A fresh random 12-byte IV is generated for every `encrypt()` call.
- Empty strings pass through unchanged (`encrypt("") === ""`), and `decrypt("")`
  returns `""`.

Encrypted fields:

- `email_logs.to`
- `smtp_config.smtpHostname`, `smtpUsername`, `smtpPassword`, `senderEmail`

Plaintext fields: `email_logs.subject`, template subject/html/text/source, error
messages/history, user email/name, API-key metadata.

There is **no key versioning or rotation**: changing `AES_256_KEY` makes every
existing ciphertext undecryptable. There is no key identifier in the payload.

---

## 8. Module catalogue

| Module | Routes | Auth | Responsibility |
|---|---|---|---|
| `send-email` | `POST /send-email` | API key | Validate payload, resolve template, create pending log, enqueue |
| `templates` | `GET/POST /templates`, `GET/PUT/DELETE /templates/:id`, `POST /templates/:id/preview` | Session | CRUD + ownership; visual-editor/code storage; renderer + preview |
| `smtp-config` | `GET/POST /smtp-config`, `GET/PUT/DELETE /smtp-config/:id` | Session | CRUD; encrypt/decrypt credentials |
| `api-keys` | `GET/POST /api-keys`, `DELETE /api-keys/:id` | Session | Create Better Auth key, link to SMTP config, list/revoke |
| `email-logs` | `GET /email-logs`, `GET /email-logs/:id` | Session | Filtered, paginated logs + history timeline |
| `dashboard` | `GET /dashboard/{stats,by-config,recent,errors}` | Session | Aggregated metrics |
| `queue` | `queue()` handler | Cloudflare | Start one workflow per message |
| `workflows` | `SendEmailWorkflow` | Cloudflare | Five durable steps + retry decision |
| `lib/auth` | `/api/auth/*` | — | Better Auth instance and plugin config |
| `middleware` | all | — | CORS/config/errors/logging/auth |
| `core` | — | — | Errors, logger, crypto, sanitizer, legacy bootstrap |

### 8.1 `send-email`

Files: `send-email.controller.ts`, `send-email.dto.ts`,
`send-email.repository.ts`, `send-email.types.ts`, `transport-resolver.ts`,
`error-classifier.ts`, `index.ts`.

- DTO: one endpoint, two mutually exclusive shapes via `z.union`:
  - `SendEmailDto`: `to`, `subject` (min 3, **no max**), `text` (10–20,000),
    `html` (1–100,000), `.strict()`.
  - `SendTemplateEmailDto`: `to`, `templateId`, optional `variables` record
    of string/number/boolean (coerced to string), `.strict()`.
- Repository: `createPendingEmailLog`, `completeEmailLog`,
  `saveEmailHistory`.
- Transport: `SmtpEmailTransport` (`transports/smtp-email.transport.ts`) creates a nodemailer
  transporter with `secure: true`, `family: 4`, `rejectUnauthorized: true`,
  connection/greeting/socket timeouts of 5s/5s/10s. It does **not** call
  `transporter.close()` (removed in `47ef9e8`; the timeouts are the hang
  safety net).
- `transport-resolver.ts` builds a fresh transport per workflow run from the
  config referenced by the event. Without `smtpConfigId` it falls back to the
  first active config, then any config — legacy behavior with no user check.
- `error-classifier.ts` is covered in §10.

### 8.2 `templates`

- CRUD scoped to `userId`; cross-user CRUD returns `403`.
- DTO caps: name 100, subject 500, editor JSON 250,000, source 100,000,
  html 100,000, text 20,000.
- `format` distinguishes `legacy` raw-HTML templates, `react-email` templates
  created by the dashboard visual editor, and `react-email-code` templates
  containing pasted TSX. `editorJson` stores `{ version: 2, theme, content }`
  for visual templates (legacy raw TipTap documents still load); `source`
  stores the TSX for code templates. `html`/`text` remain the exported,
  send-ready representation for all formats.
- The dashboard uses the full `@react-email/editor` builder for visual mode
  (canvas, contextual inspector for body/container/node styles, Basic/Minimal
  themes, Export HTML) and Sucrase plus `react-email` in a browser Web Worker
  for code mode. The Worker never executes React Email or user-pasted TSX;
  code mode stores the source and the compiled HTML/text after browser
  rendering.
- `template-renderer.ts`:
  - `VARIABLE_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g`
  - `extractVariables(...contents)` returns unique names in first-appearance
    order.
  - `renderTemplate` inserts values literally (subject, text).
  - `renderHtmlTemplate` HTML-escapes `& < > " '` before insertion.
  - `renderTemplateContent(template, variables)` performs the missing-variable
    check, renders all three fields, and enforces the inline caps. Both
    `POST /send-email` and `POST /templates/:id/preview` use it.
  - Unknown markers are left untouched when the lower-level helpers are called
    directly.

### 8.3 `smtp-config`

- DTO: hostname, username, password, sender email; update also `isActive`.
- Service encrypts on create/update and decrypts every returned record.
- `GET /smtp-config` and `GET /smtp-config/:id` therefore return the decrypted
  `smtpPassword` to the browser. The dashboard ignores it, but it is exposed
  to any script with a valid session (see §13).

### 8.4 `api-keys`

- `POST` requires `smtpConfigId` and optional `name`.
- Repository verifies the config belongs to the user, creates a Better Auth
  key (`prefix: "mk_"`), then finds the most recent key for the user and
  updates `smtpConfigId`. This "latest key" lookup is race-prone under
  concurrent creates.
- Missing/foreign SMTP config throws a plain `Error` → global handler returns
  `500`, not `404/403`.
- `GET` returns key metadata (never the secret); the full key is returned only
  once at creation.

### 8.5 `email-logs`

- Filters: `smtpConfigId`, `to`, `status`, `limit` (1–100, default 50),
  `cursor`.
- Keyset pagination on `(createdAt, internalId) DESC`; fetches `limit + 1` to
  compute `nextCursor`.
- History is attached with a single `IN (...)` query (max 100 ids, D1 bound
  parameter limit).
- `to` is encrypted, so the `to` filter runs **after** decryption and only on
  the fetched page.
- `status` uses `EXISTS` on `email_histories`; `attempt_failed` is not an
  accepted filter value.
- `smtpConfigId` uses a subquery on `apikey`; logs whose key was deleted are
  invisible to that filter.
- Cursor encoding is broken: `encodeCursor` writes
  `"<ISO createdAt>:<internalId>"`, but `decodeCursor` splits at the **first**
  `:`, which is inside the time (`2026-10-19T09:11:...`). The decoded
  `createdAt` becomes `"2026-10-19T09"` and the id becomes the rest, so the
  next page skips rows. The frontend does not paginate, which is why this is
  not user-visible yet.
- `findById` throws a plain `Error` for missing/foreign logs → `500`.

### 8.6 `dashboard`

- `GET /dashboard/stats?days=7` (default 7, max 365): `totalSent`,
  `successCount`, `failureCount`, `successRate`.
  - Counts are `COUNT(DISTINCT internalId)` over `email_logs LEFT JOIN
    email_histories`.
  - An email that failed then succeeded appears in **both** success and
    failure counts.
  - The success-rate denominator is all logs in the window, including pending
    ones, so it can be lower than expected.
- `GET /dashboard/by-config`: groups by SMTP config, but uses an **inner join**
  on `apikey`, so configs without a key are omitted.
- `GET /dashboard/recent`: latest status via a correlated subquery.
- `GET /dashboard/errors`: groups `failed` history errors.
- The frontend calls `/dashboard/stats` (without `days`, so the API default of
  7 days applies even though the card says "All time"), `/dashboard/stats?days=N`
  for the chart, and `/dashboard/errors?days=N` for the errors card.
  `/dashboard/by-config` and `/dashboard/recent` are implemented but unused.
  The chart **fabricates** a daily distribution by dividing the window totals
  evenly; the API does not expose a time series.

---

## 9. End-to-end send flows

### 9.1 Inline email

```
POST /send-email
  Authorization: Bearer mk_...        (or x-api-key)
  { to, subject, text, html }
        │
        ▼
apiKeyMiddleware
  verify key → user → apikey.smtpConfigId → smtp_config
  set userId, apiKeyId, smtpConfigId (and decrypted creds)
        │
        ▼
zValidator(SendEmailPayloadDto)  → 400 on invalid/mixed payload
        │
        ▼
emailId = createId()
encrypt(to, AES_256_KEY)
INSERT email_logs (pending: smtpId/sentAt NULL)
        │
        ▼
SEND_EMAIL_QUEUE.send({
  name: "app/send-email",
  data: { to, subject, text, html, emailId, userId, apiKeyId,
          smtpConfigId, queueCycles: 0 }
})
        │
        ├── failure → saveEmailHistory("failed", "Failed to enqueue: ...") → 500
        └── success → 202 { success: true, message: "Email queued" }
```

The pending row is created **before** enqueueing so the email is visible in
the dashboard even if the queue or every later stage fails.

### 9.2 Template email

The request follows the same path until validation. Then:

1. `templateRepo.findById(payload.templateId)`.
2. Missing **or** owned by another user → `404 "Template not found"`
   (anti-probing).
3. `renderTemplateContent(template, variables)` extracts variables.
4. Missing variables → `400 "Missing template variables: a, b"`. The check
   uses `Object.prototype.hasOwnProperty`, so prototype names such as
   `toString` are not accepted as supplied values.
5. Render:
   - subject: literal substitution.
   - text: literal substitution.
   - html: values HTML-escaped, then the normal workflow sanitization runs.
6. The rendered result is capped to the inline limits and returned as the same
   inline `SendEmailDto` shape. The queue, consumer, workflow and SMTP layer
   never learn that templates exist.

`POST /templates/:id/preview` uses the same renderer and caps, so the dashboard
preview and the queued email cannot drift apart. The editor's live preview is
client-side; the saved-template preview is rendered from stored content.

### 9.3 Queue consumer

`backend/src/queue/send-email.consumer.ts`:

For each message in the batch:

1. `env.SEND_EMAIL_WORKFLOW.create({ id: `${emailId}-${queueCycles}`, params })`.
2. `msg.ack()` only after `create()` succeeds.
3. On failure: log, and if `msg.attempts >= 4` write a `failed` history row
   (`"Failed to start workflow after N attempts: ..."`).
4. `msg.retry({ delaySeconds: 5 * 2^attempts, capped at 300 })`.

Instance id format is an idempotency key: Workflows rejects duplicate ids, so
a redelivery cannot start a second run for the same `emailId + queueCycles`.
The `-` separator is required because Workflow ids allow only
`[a-zA-Z0-9-_]` and cuid2 ids are lowercase alphanumeric.

Queue-level configuration (`wrangler.jsonc`): `max_retries: 3` (4 deliveries),
`retry_delay: 30`, DLQ `makisend-send-email-dlq`. `FINAL_ATTEMPT = 4` in the
consumer must stay in sync with `max_retries`.

### 9.4 Workflow steps

`backend/src/workflows/send-email.workflow.ts`, class
`SendEmailWorkflow`:

Before any step, `resolveTransportFor(env, data.smtpConfigId)` runs **outside**
`step.do`. A missing config or decryption failure therefore fails fast into the
classifier without checkpointing a doomed run.

| # | Step | Work | History written |
|---|---|---|---|
| 1 | `email-received-and-update-history` | log + mark received | `received` |
| 2 | `processing` | mark processing | `processing` |
| 3 | `cleaning-html-input` | `cleanHtml(data.html)`; return cleaned string | `cleaned` |
| 4 | `send-mail-via-nodemailer` | `transport.send(...)`; **`retries: { limit: 0 }`** | `sent` on success, `attempt_failed` on error |
| 5 | `save-infos-in-db` | `completeEmailLog(emailId, messageId, sentAt, durationMs)` | — (log row updated) |

Step 4 returns `JSON.stringify({ messageId, durationMs })` and step 5 parses
it. Steps must return primitives: returning an object from `step.do` triggers
a false "code had hung" cancellation in workerd
(workerd#6925 / workers-sdk#14959). Step 3 returns a string for the same
reason.

The SMTP step deliberately disables Workflows' default retries (5). SMTP is
not idempotent: an auto-retry after a lost ack could send the email twice.
`retries: { limit: 0 }` also ensures the outer `catch` sees the error and can
classify it for the queue-cycle ladder.

On success the run returns
`{ outcome: "sent", messageId, durationMs, attempt }`. On any throw, the run
builds `{ code, message }` and calls `resolveSendEmailRunEnd(...)`.

### 9.5 Retry and error-classification state machine

There are **two independent retry systems**.

| Layer | Owner | Budget | Trigger |
|---|---|---|---|
| Queue → Workflow | queue consumer + `max_retries: 3` | 4 deliveries → DLQ | `SEND_EMAIL_WORKFLOW.create()` throws |
| Workflow steps 1,2,3,5 | Workflows defaults | 5 retries each | step throws |
| SMTP step 4 | `retries: { limit: 0 }` | exactly 1 | step throws |
| Workflow → Queue | `resolveSendEmailRunEnd` | 5 cycles (6 SMTP attempts max) | transient SMTP/config failure |

`resolveSendEmailRunEnd` (`send-email.workflow.ts:89`) decides in this order:

1. **No `emailId`** → abandon (`"no emailId in payload"`).
2. **`queueCycles >= MAX_QUEUE_CYCLES` (5)** → write `failed`
   (`"Delivery abandoned after 5 queue cycles. Last error: <friendly>"`) and
   abandon.
3. **Classifier says `permanent`** → write `failed` with the friendly message
   and abandon.
4. **Queue binding missing** → write `failed` and abandon.
5. **Transient** → `SEND_EMAIL_QUEUE.send({ ...data, queueCycles: nextCycle },
   { delaySeconds })`; write a best-effort `attempt_failed` history row
   (`"Re-queued: next attempt in Ns (cycle X of 5). Last error: ..."`);
   return `requeued`.
   - If re-enqueue throws → write `failed` and abandon.

Backoff ladder: `[60, 300, 900, 1800, 3600]` seconds, indexed by the current
cycle and clamped to the last entry. Cycle 0→1 waits 60s, 4→5 waits 3600s.

The outcome type is one of:

```ts
{ outcome: "sent"; messageId; durationMs; attempt }
{ outcome: "requeued"; nextCycle; delaySeconds }
{ outcome: "abandoned"; reason }
```

#### Classification rules

`error-classifier.ts`:

1. Numeric `responseCode`: `< 500` → transient; `>= 500` → permanent.
2. SMTP status parsed from the message with `/: ([45]\d{2})[ -]/`:
   `< 500` → transient; `>= 500` → permanent.
3. Code from `err.code`, else the first known `E[A-Z_]+` token in the message.
   Permanent set wins over transient when both appear.
4. Default → **transient** (bounded by the cycle cap).

Permanent codes: `EAUTH`, `ENOAUTH`, `EOAUTH2`, `ECONFIG`, `ETLS`,
`EREQUIRETLS`, `EPROTOCOL`, `EDNS`, `ENOTFOUND`, `EENVELOPE`,
`EMAXRECIPIENTS`, `EMESSAGE`, `EFILEACCESS`, `EURLACCESS`, `EPROXY`.

Transient codes: `ECONNECTION`, `ETIMEDOUT`, `ESOCKET`, `EMAXLIMIT`,
`ESTREAM`, `EFETCH`, `EAI_AGAIN`.

`friendlyErrorMessage` maps codes to user-facing text. Notable cases:

- `EAUTH`/`ENOAUTH` → check SMTP username/password.
- `EDNS`/`ENOTFOUND` → host not found.
- `ETLS` → check port/encryption mode (465 implicit TLS, 587 STARTTLS).
- `ECONNECTION`/`ESOCKET` → if the message contains "port 25 is blocked",
  say so explicitly; otherwise check host/port/provider.
- `ETIMEDOUT` → server did not respond.
- `EENVELOPE`/`EMESSAGE` → temporary vs permanent based on the SMTP status.
- 5xx status → "permanently rejected (status N)" without forwarding the raw
  provider response.
- Unknown → generic "delivery failed unexpectedly".

Important edge case: a missing SMTP configuration is thrown as
`AppError(404, "SMTP configuration not found")`. It has no `code` and no SMTP
status, so the classifier defaults to **transient** and the email consumes the
full 5-cycle ladder before being abandoned. The same applies to any codeless
bug or unexpected error.

#### At-least-once delivery

The pipeline is at-least-once, not exactly-once:

- If SMTP accepts the message but step 5 (or the `sent` history write) fails,
  the workflow may retry step 5, or the run may fail and be re-enqueued.
- There is no provider idempotency key or dedup table.
- A duplicate send is therefore possible after a crash between SMTP success
  and the DB receipt.

---

## 10. Read paths: logs and dashboard

### 10.1 Email logs

`EmailLogRepository.findPageByUserId` builds:

- `userId = ?`
- optional `smtpConfigId` subquery
- optional `status EXISTS`
- optional keyset cursor
- `ORDER BY createdAt DESC, internalId DESC LIMIT pageSize + 1`

`attachHistory` then loads all history for the page in one query and groups it
in memory. The service decrypts `to` after fetching and applies the `to`
filter to that page.

`GET /email-logs/:id` loads one log and its history; `findById` throws plain
`Error` for missing/foreign rows, so the client sees `500` instead of
`404/403`.

### 10.2 Dashboard

- Stats are aggregated in SQL over the window (`days`, default 7).
- `by-config` inner-joins `apikey`; configs with no key disappear.
- `recent` selects the latest history status per log with a correlated
  subquery.
- `errors` groups `failed` history rows by error text.
- There is no time-series endpoint. The frontend's area chart divides the
  totals across days, producing a flat/artificial curve.

---

## 11. Security model

### 11.1 Controls present

- **Per-user API keys** verified by Better Auth; `mk_` prefix; 10,000
  requests/day per key (Better Auth rate limit).
- **Session auth** for all dashboard APIs; cookies `SameSite=None; Secure`;
  `trustedOrigins` restricted to `FRONTEND_URL` for Better Auth.
- **AES-256-GCM** at rest for recipient addresses and all SMTP fields.
- **TLS verification** (`rejectUnauthorized: true`) and forced IPv4.
- **HTML sanitization** with a restrictive allowlist before SMTP send.
- **Zod `.strict()`** payloads on every write endpoint.
- **Ownership checks** in services; template probing returns the same 404 for
  missing and foreign ids.
- **Registration closed** after the first user.
- **No secrets in the repo** (`.dev.vars`, `.env` ignored).

### 11.2 Gaps and risks

| Severity | Gap | Impact |
|---|---|---|
| High | CORS reflects any `Origin` and allows credentials | Any website can make credentialed requests to dashboard APIs if the browser sends the cookie; combined with `SameSite=None`, this is a CSRF exposure. |
| High | `allowHeaders` omits `x-api-key` | Cross-origin browser calls using the documented `x-api-key` header fail preflight. `Authorization` works. |
| High | `GET /smtp-config` returns decrypted `smtpPassword` | Any session (or XSS) can read SMTP credentials; the UI does not need them. |
| High | Production/preview D1 is wiped on every deploy | Data loss by design while the POC iterates; unacceptable for real users. |
| Medium | Error handler returns raw `error.message` for unhandled 500s | Internal details (SQL, provider text) can leak to clients. |
| Medium | Pino logs plaintext recipient addresses and full query strings | PII in logs; no request IDs or redaction. |
| Medium | `attempt_failed` history stores raw SMTP error text | Provider hostnames/recipient details visible in the dashboard. |
| Medium | No key rotation/versioning | Changing `AES_256_KEY` destroys all encrypted data. |
| Medium | Missing SMTP config retries 5 cycles | Wasted queue/workflow work for a permanent configuration error. |
| Medium | `findSmtpRecord` fallback has no user check | Legacy events without `smtpConfigId` can use another tenant's active config. |
| Low | `secure: true` hardcoded | Port 587/STARTTLS cannot work without a code change. |
| Low | `Bindings.PORT` typed `number` but Wrangler vars are strings; config does not validate it | Runtime type mismatch; nodemailer may coerce. |
| Low | Auth instance cache ignores `BETTER_AUTH_SECRET` | A secret rotation in a warm isolate is not picked up. |
| Low | `email_logs.userId` has no FK | Orphan logs if the user deletion hook is bypassed. |
| Low | `email_histories` orphaned on user deletion | Unbounded orphan growth. |
| Low | `email-logs` cursor bug | Pagination skips rows; currently masked by the UI. |
| Low | Dashboard stats double-count and pending denominator | Misleading success rate. |
| Low | No edge rate limiting beyond Better Auth's per-key limit | A valid key can still burst; no per-IP or per-user ceiling. |
| Low | No DKIM/SPF/DMARC handling | Deliverability depends entirely on the provider/domain. |

---

## 12. Observability

- **Pino** (`core/logger.ts`) writes JSON lines to `console.log` — the
  edge-compatible destination; no Node transport, no `pino-pretty` in the
  Worker.
- Request logs include method, URL, status and duration. There is no request
  id, trace id or user id on the request log line.
- Workflow and queue code log `receiver`, `emailId`, `smtpId`, attempt and
  durations. Recipient addresses are plaintext.
- The business timeline lives in `email_histories`: `received` → `processing`
  → `cleaned` → `sent` (or `attempt_failed` → ... → `failed`).
- `wrangler.jsonc` enables Workers Logs (`observability.logs`) and disables
  traces.
- There are no metrics, alerting, dashboards or DLQ inspection tooling in the
  repo. The DLQ exists but nothing consumes or reports on it.

---

## 13. Frontend architecture

- Astro 7 pages mount React 19 islands with `client:load`.
- Pages: `/` (marketing), `/login`, `/register`, and `/dashboard/{index,
  email-logs, templates, smtp-config, api-keys, settings}`.
- `SessionGuard` checks `/api/auth/get-session` in the browser and redirects
  to `/login`; it is client-side only, so protected HTML is briefly served
  before the redirect. Real protection is server-side on the API.
- `fetchApi(path, init)` calls `fetch(path, { credentials: "include", ...init })`
  — same-origin in production, Vite proxy in dev.
- The dev proxy forwards `/api`, `/docs`, `/openapi.json`, `/smtp-config`,
  `/api-keys`, `/email-logs`, `/templates` and the four `/dashboard/*` paths to
  `BACKEND_URL` (`http://localhost:8787` by default, `http://backend:8787` in
  Docker).
- The template page mounts the official `@react-email/editor` and saves its
  exported HTML/text plus TipTap JSON. It still duplicates the backend's
  `{{variable}}` regex for the live preview; the saved-template preview uses
  the same escaping rules as the send path.
- The dashboard chart fabricates daily data from totals (see §8.6).
- `Layout.astro` ignores its `title` prop and hardcodes `<title>Astro
  Basics</title>`.
- There are no frontend tests or lint scripts.

---

## 14. Deployment and environments

### 14.1 Local

- `backend/.dev.vars` is what Wrangler reads; `.env.example` mentions `.env`,
  but for the Worker use `.dev.vars` (or pass vars with `wrangler dev --var`).
- D1 migrations: `pnpm exec wrangler d1 migrations apply makisend_db --local`.
- `pnpm dev` in `backend/` runs `wrangler dev --local`; Miniflare simulates
  D1, Queues and Workflows.
- `pnpm --filter ./frontend dev` runs Astro on port 4321 and proxies to 8787.
- Docker Compose runs both with bind mounts; local D1 state persists in
  `backend/.wrangler`.

### 14.2 Production

`.github/workflows/deploy.yml`:

- Triggers on **every push to any branch**, plus `workflow_dispatch`.
- Build job: install, lint backend, test backend, build frontend, upload
  `frontend/dist`.
- Deploy job: **deletes and recreates the production D1 database on every
  deploy**, rewrites `database_id` in `wrangler.jsonc`, applies migrations,
  ensures the queue exists, deploys the Worker, checks that the four secrets
  exist (it does not set them), comments the production URL on an open PR.
- Preview job (PRs from the same repo): deletes/recreates
  `makisend-db-preview`, uses the preview queue/workflow, deploys
  `--env preview`, comments the preview URL.
- Secrets must be provisioned once by hand:
  `AES_256_KEY`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `FRONTEND_URL`.
  `BETTER_AUTH_URL` and `FRONTEND_URL` must be the production Worker URL
  because UI and API share an origin.
- CI (`.github/workflows/ci.yml`) runs only lint + tests on PRs to `main`/`dev`.
  It does **not** run `tsc`.

### 14.3 Docker

- Root `Dockerfile` (Node 22 + pnpm 11), `docker-compose.yml` with `backend`
  (Wrangler on 8787) and `frontend` (Astro on 4321, `BACKEND_URL`).
- Root scripts: `pnpm docker:build|up|down|test|lint|migrate`.
- Secrets are not baked into the image; `.dev.vars` is bind-mounted.

---

## 15. Design decisions and trade-offs

| Decision | Why | Cost |
|---|---|---|
| HTTP → Queue → Workflow → SMTP | Decouples the 202 response from a long, failure-prone SMTP dial; durable retries; bursts are buffered | Eventual consistency; delivery only visible in logs; more moving parts |
| One SMTP attempt per workflow run, retries via queue cycles | SMTP is not idempotent; classification happens in-process where the error is richest | Up to 6 attempts over ~1h for transient errors; missing-config errors waste the ladder |
| `retries: { limit: 0 }` on the SMTP step | Prevents duplicate sends from Workflows' default retries | Relies on the queue-cycle ladder for all retries |
| Step callbacks return primitives (string/JSON) | Avoids the workerd false "hung" cancellation | Awkward `JSON.parse` in step 5 |
| Per-user SMTP configs encrypted in D1 | No Worker-level SMTP secrets; multi-tenant ready | No key rotation; config CRUD returns decrypted secrets |
| Render templates at request time | Queue/workflow/SMTP stay template-agnostic; missing variables fail fast with 400; output is capped | Preview regex is duplicated in the dashboard; the editor is browser-only |
| Single Worker serves UI + API | No CORS in production, one deploy, one URL | Frontend build must precede deploy; Worker size/asset limits |
| D1 + Drizzle | Serverless SQLite, simple local simulation, typed schema | D1 parameter limits, no long transactions, latency at scale |
| Manual DI via getters | Hono has no IoC; testable controllers | Module-level singleton state; auth cache invalidation is partial |
| Pino to console | Works on Workers without Node transports | No structured sink, no request correlation |

---

## 16. Known limitations (consolidated)

**Correctness / data**

- At-least-once delivery; duplicate emails possible after a lost ack or a
  crash between SMTP success and the DB receipt.
- Cursor pagination decodes incorrectly and skips rows.
- Dashboard stats count an email as both success and failure if it retried
  successfully; success-rate denominator includes pending emails.
- `dashboard/by-config` omits configs without API keys.
- Frontend chart data is fabricated from totals.
- `email_histories` are orphaned when a user is deleted.
- Missing SMTP config is classified as transient and consumes the full retry
  ladder.

**Security**

- CORS reflects any origin with credentials; `x-api-key` is missing from
  `allowHeaders`.
- SMTP passwords are returned by `GET /smtp-config`.
- Raw error messages are returned on unhandled 500s.
- Recipient addresses and query strings are logged in plaintext.
- Raw SMTP error text is stored in `attempt_failed` history.
- No key rotation/versioning.
- No edge rate limiting beyond Better Auth's per-key 10k/day.

**Operations**

- Production and preview D1 are wiped on every deploy.
- No DLQ consumer/reporting.
- No metrics/traces/alerting; no request IDs.
- No `tsc` in CI; known test-only type errors exist.
- `worker-configuration.d.ts` is stale and tracked.
- Root `package.json` has no `dev`/`test`/`lint` scripts; README's root
  `pnpm dev` is misleading.

**Product / protocol**

- `secure: true` hardcoded → 587/STARTTLS unsupported.
- Single SMTP provider per key; no failover.
- No open/click tracking and no outgoing webhooks. Later bounces and complaints
  are read only from the provider's delivery webhook (`src/bounce-webhooks/`:
  Resend, SendGrid, Mailgun, Postmark).
- No SPF/DKIM/DMARC management.
- Sign-up is closed after the first user.
- `create-user.ts` is a legacy API-key-only bootstrap that creates a
  synthetic email; it cannot be used for Better Auth email/password login.

---

## 17. Where to look

| Concern | File |
|---|---|
| Worker entrypoint, middleware order, DI | `backend/src/index.ts` |
| Bindings → typed config | `backend/src/config/config.ts` |
| Auth (sessions, API keys, delete hook) | `backend/src/lib/auth.ts` |
| API-key middleware | `backend/src/middleware/api-key.middleware.ts` |
| Send endpoint | `backend/src/send-email/send-email.controller.ts` |
| Payload schemas | `backend/src/send-email/send-email.dto.ts` |
| SMTP transport | `backend/src/transports/smtp-email.transport.ts` |
| Transport resolution | `backend/src/send-email/transport-resolver.ts` |
| Error classification | `backend/src/send-email/error-classifier.ts` |
| Queue consumer | `backend/src/queue/send-email.consumer.ts` |
| Durable workflow + retry decision | `backend/src/workflows/send-email.workflow.ts` |
| Template rendering | `backend/src/templates/template-renderer.ts` |
| Template editor | `frontend/src/components/template-editor.tsx` |
| Schema | `backend/src/db/schema.ts` |
| Crypto | `backend/src/core/crypto.ts` |
| HTML sanitizer | `backend/src/core/html-sanitizer.ts` |
| Logs + pagination | `backend/src/email-logs/email-logs.repository.ts` |
| Dashboard queries | `backend/src/dashboard/dashboard.repository.ts` |
| Deployment | `backend/wrangler.jsonc`, `.github/workflows/deploy.yml` |
| Frontend API helper | `frontend/src/lib/api.ts` |
| Frontend dev proxy | `frontend/astro.config.mjs` |

---

*See `DEVELOPER_GUIDE.md` for setup, commands, testing, recipes and a reuse
checklist.*
