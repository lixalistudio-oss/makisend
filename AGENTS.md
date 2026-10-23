# AGENTS.md — MakiSend

## Overview

MakiSend is a **Proof of Concept (POC)** for a **serverless** transactional email service deployed on **Cloudflare Workers**.

The three questions this POC tries to validate:

1. Can we deploy a serverless backend using **nodemailer** and raw SMTP on Cloudflare Workers?
2. Can it work at scale?
3. Can emails land in the inbox instead of spam folders?

The product aims to provide a simple API for sending transactional emails without managing a dedicated server.

## Tech stack

- **Runtime**: Cloudflare Workers (`workerd`)
- **Web framework**: Hono
- **Validation**: Zod + `@hono/zod-validator`
- **ORM / Database**: Drizzle ORM + Cloudflare D1 (SQLite)
- **Email delivery**: nodemailer via raw SMTP
- **Business logic**: Repository / Service / Controller
- **Logging**: Pino (configured for edge environment, no Node.js transport)
- **Tests**: Vitest
- **Lint**: ESLint + TypeScript ESLint
- **Encryption**: Web Crypto API (AES-256-GCM)
- **HTML sanitization**: sanitize-html

## Project structure

The project follows a **NestJS-inspired modular architecture**:

```
src/
├── index.ts                    # Hono entrypoint, bindings, route wiring, DI
├── api-keys/                   # Per-user API key module (Better Auth)
├── config/
│   └── config.ts               # Typed Config object built from Bindings
├── core/                       # Shared kernel
│   ├── errors.ts               # AppError and subclasses
│   ├── logger.ts               # Edge-compatible Pino logger
│   ├── crypto.ts               # AES-256-GCM encryption / decryption
│   ├── html-sanitizer.ts       # HTML sanitization
│   └── create-user.ts          # User bootstrap helper
├── dashboard/                  # Delivery metrics / stats endpoints
├── db/
│   ├── schema.ts               # Drizzle schema (users, apikeys, smtp_config, email_logs, ...)
│   └── connection.ts           # drizzle(db) factory
├── email-logs/                 # Email log listing with filters
├── lib/
│   └── auth.ts                 # Better Auth setup (API keys)
├── middleware/
│   ├── api-key.middleware.ts   # API key auth (401/403, Better Auth verification)
│   ├── config.middleware.ts    # Injects Config into Hono context
│   ├── error.handler.ts        # Global error handler
│   ├── request-logger.middleware.ts # Request logging
│   └── session.middleware.ts   # Session/auth middleware
├── queue/
│   └── send-email.consumer.ts  # Cloudflare Queue consumer → SendEmailWorkflow runs
├── send-email/                 # Business module (barrel export via index.ts)
│   ├── index.ts
│   ├── send-email.controller.ts
│   ├── send-email.dto.ts       # Zod schemas + types
│   ├── send-email.repository.ts # Drizzle/D1 persistence
│   ├── send-email.loader.ts    # Rebuilds + decrypts an email from D1
│   ├── attachments.ts          # Resend-shaped `attachments` DTO, caps, base64 decoding
│   ├── transport-resolver.ts   # Per-event SMTP transport factory
│   ├── error-classifier.ts     # Permanent/transient verdicts + human-readable messages
│   └── send-email.types.ts     # Interfaces / contracts
├── idempotency/                # HTTP Idempotency-Key for POST /send-email
├── send-rate-limit/            # Optional per-API-key send quota (SEND_RATE_LIMIT)
├── openapi/                    # OpenAPI 3.1 document (request schemas generated from Zod DTOs)
├── smtp-config/                # SMTP configs, TLS/port validation, connection checks
│   ├── smtp-host.ts            # Hostname/port/security parsing and defaults
│   ├── smtp-connection.ts      # Shared nodemailer options, check/test-send helpers
│   └── smtp-health.ts          # Scheduled check over every stored config
├── transports/                 # Delivery transports (SmtpEmailTransport over nodemailer)
│   ├── index.ts                # Barrel export
│   └── smtp-email.transport.ts # IEmailTransport implementation, one connection per send
├── templates/                  # Email templates (legacy HTML, React Email visual editor, or pasted TSX)
│   ├── index.ts                # Barrel export
│   ├── templates.types.ts      # Contracts / repository interface
│   ├── templates.dto.ts        # Create/Update/Preview Zod schemas + format/editorJson/source
│   ├── templates.repository.ts # Drizzle/D1 persistence
│   ├── templates.service.ts    # CRUD + ownership + format/source invariants + preview
│   ├── templates.controller.ts # /templates routes (session auth)
│   └── template-renderer.ts    # extractVariables / render / shared output caps
└── workflows/                  # Cloudflare Workflows (durable async orchestration)
    ├── index.ts                # Barrel export
    ├── send-email.flow.ts      # Durable steps + 3 retries + dead-letter publication
    └── send-email.workflow.ts  # SendEmailWorkflow entrypoint (id-only payload)

test/
├── setup.ts
├── helpers/d1-setup.ts
├── integration/full-flow.test.ts
└── unit/
    ├── api-keys/ auth/ config/ dashboard/ email-logs/ openapi/
    ├── send-email/             # error classifier, transport resolver, controller
    ├── idempotency/            # replay / conflict / 5xx retry behaviour
    ├── workflows/              # send flow retries, DLQ, classifier integration
    ├── transports/             # SmtpEmailTransport (send + close)
    ├── middleware/ queue/ send-emails/ settings/ smtp-config/
```

## Essential commands

```bash
# Install dependencies
pnpm install

# Start local dev server
pnpm dev

# Generate Cloudflare Bindings types
pnpm cf-typegen

# Run tests
pnpm test:run

# Run tests in watch mode
pnpm test

# Run lint
pnpm lint

# Auto-fix lint
pnpm lint:fix

# Deploy to Cloudflare Workers
pnpm deploy
```

## Environment variables

Copy `.env.example` to `.env` and fill in:

| Variable | Description |
|----------|-------------|
| `ENCRYPTION_KEY` | Current 64-character hex AES-256 key (`openssl rand -hex 32`). The legacy name `AES_256_KEY` is still read |
| `ENCRYPTION_KEY_PREVIOUS` | Optional, decrypt-only keys during a rotation, comma-separated |
| `BETTER_AUTH_SECRET` | Signs sessions and encrypts the TOTP secrets and backup codes. Changing it signs everyone out and breaks existing two-factor set-ups (see "Accounts and authentication") |
| `BETTER_AUTH_URL` | Backend URL of the Worker (e.g. `http://localhost:8787`) |
| `FRONTEND_URL` | Frontend origin allowed for CORS / redirects |
| `SEND_RATE_LIMIT` | Optional per-API-key send quota (`100/min`, `5000/day`). Unset: no quota |

Not environment variables anymore:

- **SMTP credentials, port and TLS mode** (`SMTP_USER`, `SMTP_PASSWORD`, `SENDER_EMAIL`, `HOST`, port, `tls`/`starttls`): stored per SMTP config, credentials encrypted in D1, managed through the `smtp-config` module. Ports are limited to the submission ports a Worker can reach; port 25 is refused.
- **`API_KEY`**: API keys are per user, created via the `api-keys` module (Better Auth), and sent as `x-api-key` or `Authorization: Bearer`.

These variables are mapped in `src/index.ts` via the `Bindings` type, transformed into a typed `Config` via `createConfig()`, and injected into services at runtime.

## Target architecture inspired by NestJS

Even though the runtime remains **Hono** (not NestJS), the code organization is inspired by NestJS architectural principles:

- **Modules**: each business domain (e.g. `send-email`) is a cohesive module exporting its controllers, services, repositories and DTOs via an `index.ts` barrel file.
- **Controllers**: `*.controller.ts` files contain only HTTP code — routing, input validation (DTO), and response formatting.
- **Providers / Services**: business logic lives in services. They know nothing about the web framework.
- **Repositories**: persistence is isolated behind an interface / contract (`IEmailRepository`). The concrete repository can be implemented with Drizzle/D1 today and replaced later without touching the service.
- **DTOs / Schemas**: Zod validation schemas are extracted into `*.dto.ts` files next to the controller. They serve both as API contracts and TypeScript types (`z.infer`).
- **Manual dependency injection**: Hono has no native IoC container. Dependencies are injected through constructors (`new Service(new Repository(...), config)`), or via controller factories that take lazy getters (`createSendEmailController(() => deps.emailRepository!, ...)`), wired in `src/index.ts`.
- **Shared kernel**: cross-cutting code (logger, errors, encryption, configuration) lives in `src/core/` and depends on no business module.

### Anti-patterns to avoid

- Do not instantiate a repository directly in a route.
- Do not mix SMTP / nodemailer logic with persistence logic.
- Do not use `c.env` beyond the entrypoint and factories: transform `Bindings` into a typed `Config` as early as possible.
- Do not import `nodemailer` or `drizzle` directly from a controller.

## Code conventions

- **Strict TypeScript** implicitly via `tsconfig.json`
- **Double quotes** and **semicolons** in source code
- Controllers only: receive request, validate DTO, call service, return response
- Services contain business logic and are testable without Hono
- Repositories implement an interface to stay replaceable
- Application errors use `AppError` (status code + message)
- Logs go through `pinoLogger`
- No `pino-pretty` transport in production Worker

## Security

- **API key authentication**: `src/middleware/api-key.middleware.ts` verifies per-user API keys via Better Auth (`401` missing header, `403` invalid key), with header `x-api-key: <KEY>` or `Authorization: Bearer <KEY>`. Keys are created/listed/revoked through the `api-keys` module.
- **Encryption**: SMTP credentials, recipients and email bodies are encrypted with AES-256-GCM before storage. Ciphertexts are `{"kid","iv","data"}` JSON; `kid` is a public fingerprint of the key, used by the key rotation below.
- **HTML sanitization**: HTML content is cleaned with `sanitize-html` before sending.
- **Template ownership**: the `templateId` branch of `POST /send-email` checks that the template belongs to the API key's user (a foreign or unknown id answers the same `404` so ids cannot be probed).
- **Verified TLS**: SMTP connections use `rejectUnauthorized: true`.
- **Strict validation**: payloads are validated with Zod (`strict()` blocks unexpected fields).

### Accounts and authentication

**One account: the super admin, created at the first connection.** While no account exists, `GET /api/setup-status` answers `{ needsSetup: true }` and the dashboard sends every visitor to `/setup` (`/register` redirects there), where the first connection creates the administrator with an email and a password. After that, every account creation is refused with 403 (`SETUP_COMPLETE`) and `/setup` redirects to `/login`.

- The rule is enforced on account creation itself (`databaseHooks.user.create.before` in `src/lib/auth.ts`), not on the sign-up route: any Better Auth endpoint or server-side call that creates a user goes through it. `core/create-user.ts` (direct insert) claims the instance the same way.
- It is atomic: each creation claims the single row of `instance_owner` with one conditional UPSERT (`src/lib/owner-lock.ts`), so concurrent first sign-ups create exactly one account (the previous count-then-insert check let a race create two). A claim whose account was never created is freed after 30 s while no user exists. An instance that already has an account stays locked after the migration: the claim requires an empty `user` table.
- Deleting the account (Settings > Delete Account) releases the instance: the next connection sets it up again. There is no password reset by email.

**Two-factor authentication (TOTP).** Settings > Two-factor authentication turns on TOTP with any authenticator app (Google Authenticator, 1Password, Authy...): the password is asked, a QR code and a manual key are shown with 10 backup codes, and 2FA only turns on once a first code is accepted. Sign-in then asks for the code after the password (`twoFactorRedirect`), with a backup code as fallback and an optional 30-day trusted device. Better Auth's `twoFactor` plugin: 3 attempts per 10 s per IP on `/two-factor/*`, 5 attempts per challenge, account locked 15 min after 10 failures.

The TOTP secret and backup codes (`two_factor` table) are encrypted by Better Auth with `BETTER_AUTH_SECRET`, **not** with `ENCRYPTION_KEY`: the key-rotation job does not touch them and they are not in `ENCRYPTED_COLUMNS`. Rotating `BETTER_AUTH_SECRET` breaks existing set-ups unless you use Better Auth's versioned secrets (`BETTER_AUTH_SECRETS=2:new,1:old`); otherwise turn 2FA off, rotate, turn it on again.

**Sign-in without a password (email + authenticator code).** Once 2FA is on, the account can opt in (Settings, password required) to sign in with its email and a TOTP code only (`POST /api/auth/sign-in/totp`, `src/lib/totp-sign-in.ts`). The code then becomes the only factor, so it is off by default. Same 401 for an unknown email, an account that did not opt in and a wrong code; a code is accepted once (replay refused); wrong codes count toward the same 10-failure / 15-min lockout; `/sign-in/*` is limited to 3 attempts per 10 s per IP. Turning 2FA off turns it off too.

Tests: `test/unit/auth/auth-routes.test.ts` (single account, races, 2FA, passwordless, replay, lockout).

### Key rotation

`decrypt` tries the key matching `kid` first, then every configured key (values written before `kid` existed have none). New values are always encrypted with `ENCRYPTION_KEY`.

1. Copy the current `ENCRYPTION_KEY` (or `AES_256_KEY`) into `ENCRYPTION_KEY_PREVIOUS` (comma-separated if several keys are still in use).
2. Set a new `ENCRYPTION_KEY` (`openssl rand -hex 32`) as a Worker secret. No deploy needed.
3. The hourly cron (`17 * * * *`, `src/key-rotation`) re-encrypts up to 200 values per column per run through a compare-and-swap `UPDATE` (a value edited in between is never overwritten) and logs `key-rotation: run complete` with `{reEncrypted, failed, remaining}`.
4. Once a run logs `remaining: 0` and `failed: 0`, delete `ENCRYPTION_KEY_PREVIOUS` (and the legacy `AES_256_KEY`).

**Never replace the key outright once the database holds data**: SMTP credentials, recipients and bodies become unreadable. Every encrypted column must be listed in `ENCRYPTED_COLUMNS` (`src/key-rotation/key-rotation.repository.ts`). The daily cron (`17 3 * * *`) still runs the SMTP health checks; `scheduled` dispatches on the expression.

### Current security limitations

- **Send quota is opt-in (`SEND_RATE_LIMIT`)**: Better Auth's per-key quota stays off (`apiKeyOptions.rateLimit.enabled = false` in `src/lib/auth.ts`, which also overrides the quota stamped on existing keys). The instance owner can set `SEND_RATE_LIMIT=<count>/<s|min|hour|day>`: `src/send-rate-limit/` counts sends per API key in a fixed window (`send_rate_limit` table, one atomic UPSERT per send) and answers `429` + `Retry-After` past it. It runs after API-key auth and **before** idempotency, so a 429 is never stored as a key's replayable response. Unset: no quota and no table write; a malformed value is a 500, never unlimited.
- **No webhook / signature**: no request origin verification beyond the API key.
- **No dedicated audit logs**: only Pino application logs are present.

## Technical notes

- **Per-config SMTP port/security**: `smtpPort` and `smtpSecurity` (`tls` or `starttls`) live on the SMTP config; port 465/2465 means implicit TLS, the other allowed ports require STARTTLS
- **SMTP provider presets** live in the frontend (`frontend/src/lib/smtp-form.ts`, with the hostname cleaning); `SMTP_PORTS` there must match `backend/src/smtp-config/smtp-host.ts`.
- **Cloudflare Email Service**: a config on `smtp.mx.cloudflare.net` is sent through the `send_email` binding (`EMAIL`, `src/send-email/cloudflare-email.transport.ts`), never a socket (workerd refuses it). The transport resolver, `SmtpConfigService` (check, test send) and the daily health check all branch on `isCloudflareEmailHost`. Bindings are not inherited by `env.preview`: declare `send_email` in both.
- **Test sends are logged**: `email_logs.source` is `"api"` or `"test"`; a test carries `smtp_config_id` (no API key). The `smtpConfigId` log filter returns the config's keys' sends plus its tests; dashboard totals count `source = "api"` only.
- **Several API keys per SMTP config** (`apikey.smtp_config_id` is indexed, not unique). Per-key metrics: `GET /dashboard/by-api-key`; logs filter `apiKeyId`.
- **Unhandled errors answer a generic 500** (`src/middleware/error.handler.ts`): their message can carry SQL or binding names, so it is only logged. `AppError` messages are written for the caller and are sent.
- **SMTP connection by hostname**: nodemailer receives a `getSocket` callback that opens the socket by hostname, working around workerd's implicit-TLS/IP limitation; the same options power sends and health checks
- **Forced IPv4** in nodemailer (`family: 4`) to avoid `workerd` network warnings
- **Workflow steps return primitives**: a `step.do` callback must never return an object — the Workflows runtime then emits a false "code had hung" cancellation right after the run (workerd#6925 / workers-sdk#14959); multi-value steps return a `JSON.stringify` string that the run parses back
- **Verified TLS** (`rejectUnauthorized: true`) to prevent MITM attacks
- **Encryption** of recipient email address before database storage
- **HTML sanitization** of incoming content before sending
- **Templates render at request time**: `templateId` payloads are resolved (load → missing-variable check → render → HTML-escape → output caps) into the same inline shape before enqueueing, so the queue, workflow and SMTP layer never learn that templates exist; missing variables fail fast with `400` and a list of names. `POST /templates/:id/preview` uses the same `renderTemplateContent` helper.
- **React Email editor is browser-only**: visual mode mounts the full `@react-email/editor` builder (canvas, `Inspector`, Basic/Minimal themes, Export HTML) and stores `format: "react-email"`, an `editorJson` envelope (`{ version: 2, theme, content }`), and exported `html`/`text`. Legacy raw TipTap documents still load. Code mode stores `format: "react-email-code"`, `source`, and the HTML/text rendered by a browser Web Worker (Sucrase + `react-email`). The Worker never executes React Email or user-pasted TSX.
- No Node.js `Buffer`: use `Uint8Array`, `TextEncoder` / `TextDecoder`, and Web Crypto API

## Tests

- Framework: **Vitest**
- Config: `vitest.config.ts`
- Global setup: `test/setup.ts`
- Current coverage:
  - `POST /send-email` route (validation + 202 response, inline and `templateId` branches: rendering, missing variables → 400, foreign template → 404, mixed payload → 400)
  - Email service (mock transport, repository, encryption)
  - Template renderer (`extractVariables` / `renderTemplate` / `renderHtmlTemplate` / `renderTemplateContent` with HTML escaping and output caps)
  - Pasted TSX code templates: source round-trip, required-source validation, code-mode UI preview
  - Template editor storage and preview (DTO format/editorJson/source, repository round-trip, service invariants, preview route)
  - Retry pipeline: error classifier, workflow retries, DLQ publication, queue consumer dedup
  - HTTP idempotency: replay, body-mismatch conflict, in-progress conflict, 5xx retry
  - API key middleware (401/403 + context wiring, inactive SMTP config refusal)
  - SMTP host/port validation, transport options, error classification
  - SMTP check/test-send endpoints and per-config transport resolution
- Mocks are reset in `beforeEach`
- Run `pnpm test:run` before committing

## Database and migrations

- Database: **Cloudflare D1** (SQLite)
- ORM: **Drizzle**
- Schema: `src/db/schema.ts`
- Config: `drizzle.config.ts`
- Migrations: managed in the `drizzle/` folder
- Wrangler binding: `makisend_db`
- Email bodies live in `email_contents` (encrypted, keyed by `email_logs.internalId`); attachments live in `email_attachments`, one encrypted row per file (base64 then AES-GCM), never in the queue; templates store visual-builder JSON (theme + TipTap content) or pasted TSX source alongside exported HTML/text;
- **Attachments, end to end**: the same Resend-shaped `attachments` are accepted by `POST /send-email` and by the dashboard's test send (`POST /smtp-config/:id/test-send`, "Attach a file" in `smtp-test-send-dialog.tsx`); both validate through `send-email/attachments.ts` (`AttachmentsDto`) and both senders carry them (SMTP and the Cloudflare `send_email` binding). The frontend repeats the limits in `frontend/src/lib/attachments.ts` (keep them equal). `pnpm test:e2e:attachments` (`test/e2e/run-attachments.sh` + `attachments.ts`) runs the real Worker under `wrangler dev`, sends files through both doors to a Cloudflare Email Service configuration and compares, byte for byte, the files Miniflare's local binding writes; it leaves `test/e2e/reports/attachments.json` to diff.
  queue/workflow payloads carry only `emailId`
- HTTP idempotency reservations/responses live in `idempotency_keys` (24h TTL)

## Deployment

Deployment is done via Wrangler:

```bash
pnpm --filter frontend build   # required first: the Worker serves frontend/dist
pnpm deploy                    # backend/ — uploads Worker + static assets
```

Config: `wrangler.jsonc`

- Worker name: `makisend-poc`
- Entry point: `src/index.ts`
- Compatibility: `2026-07-10` with `nodejs_compat` flag
- Observability: logs enabled
- D1 binding: `makisend_db`
- Cron: `17 3 * * *` runs the SMTP health check (`src/smtp-config/smtp-health.ts`)
- Static assets: `../frontend/dist` (Astro build output) — the Worker serves the
  frontend and the API on the **same origin**, so there is no Cloudflare Pages
  project and no CORS between UI and API

## API documentation

The Worker serves its own reference:

- `GET /dashboard/api-docs` — guided in-app reference (signed-in dashboard users)
- `GET /docs` — Scalar UI (CDN script, nonce-based CSP)
- `GET /openapi.json` — OpenAPI 3.1 document

`src/openapi/openapi.ts` is hand-written for responses and paths, but request
schemas come from the runtime Zod DTOs via `z.toJSONSchema(...)` (input mode).
When a DTO changes, the spec follows automatically; the test suite also verifies
that every `$ref` resolves and every operation has responses. SMTP config
responses intentionally omit `smtpPassword`.

## CI / GitHub Actions

The workflow `.github/workflows/ci.yml` triggers on pushes and pull requests targeting `main` or `dev`.

Steps run:

1. Checkout code
2. Setup pnpm and Node.js 22
3. `pnpm install --frozen-lockfile`
4. `pnpm lint` (backend)
5. `pnpm exec tsc --noEmit` (backend)
6. `pnpm test:run` (backend)
7. `pnpm --filter frontend build`

## Roadmap (from Excalidraw design)

### POC (current)

- `POST /send-email` endpoint with per-user API key auth (Better Auth)
- Email templates: `/templates` CRUD (session auth) + `templateId`/`variables` branch on `POST /send-email` (API key auth), rendered at request time before enqueueing; frontend page at `/dashboard/templates` with full visual builder (inspector, themes, export), pasted-TSX code mode, and live preview
- Async delivery pipeline: Cloudflare Queues → SendEmailWorkflow → SMTP
- Delivery via nodemailer + raw SMTP
- Retry loop: one initial SMTP attempt + 3 retries 30 s apart inside the same workflow; permanent failures stop immediately, and an exhausted budget writes `failed` and dead-letters the email. The Queue consumer retries only workflow startup with exponential backoff before the DLQ
- Encrypted logs + encrypted email bodies stored in D1
- Per-config SMTP port/TLS mode, connection check and test-send endpoints; a daily cron checks every config and stores `lastCheckAt`/`lastCheckOk`/`lastCheckError`
- OpenAPI 3.1 document + Scalar UI at `/docs`; request schemas generated from the Zod DTOs
- `Idempotency-Key` support on `POST /send-email` (24h replay window)
- Unit tests for route / service / middleware
- GitHub Actions CI (lint, typecheck, tests, frontend build) on pushes/PRs to `main` and `dev`
- Deployment test on Cloudflare Workers

### Internal MVP

- ~~Endpoint security~~ (done: per-user API keys via Better Auth)
- ~~SMTP credentials management via D1 / seeding~~ (done: `smtp-config` module, encrypted at rest)
- ~~Monitoring and delivery metrics~~ (done: `dashboard` + `email-logs` modules)

### Public Beta MVP

- **Message and job queues**: Cloudflare Queues + Workflows are already in place (see POC); remaining work is scale/throughput tuning
- Scale and throughput management
- Deliverability improvements (anti-spam, SPF/DKIM/DMARC)

## Known limitations and constraints

### Serverless-related (from Excalidraw)

- **Limited execution time**: Cloudflare Workers have a per-request CPU limit. A long synchronous SMTP send can fail.
- **Cold start**: first invocation may experience additional latency.
- **Pricing**: cost can become high on large volumes or long executions.
- **Long connections are inefficient**: SMTP keeps a TCP connection; recreating it on every Worker request is not optimal.

### POC-related

- **Asynchronous sending only**: the caller gets `202 Accepted` when the email is queued; the actual delivery happens later (Queues → SendEmailWorkflow → SMTP) and is only visible through the D1 logs.
- **Single SMTP provider**: credentials are stored per user in D1 (encrypted), but there is no multi-provider routing or failover.
- **Coarse rate limiting**: Better Auth's per-key limit is not a configurable tenant quota.
- **Bounded retry, not unlimited**: each email gets **1 initial SMTP attempt + 3 retries** 30 seconds apart. Transient failures are retried inside the same workflow instance and dead-lettered when the budget is exhausted; permanent failures (auth, TLS, DNS, config, 5xx) stop immediately with a human-readable reason in D1. A hung attempt is bounded by the SMTP socket timeouts and the 2-minute step timeout.
- **No bounce / open / click tracking**: only send logs are stored.
- **D1 is a serverless SQLite database**: possible latency, not ideal for very high volumes without caching.
- **Deliverability**: SPF, DKIM, DMARC and IP reputation are not handled by the code; they depend on the SMTP provider and sender domain.

## Useful resources

- [Hono](https://hono.dev/)
- [Drizzle ORM](https://orm.drizzle.team/)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [nodemailer](https://nodemailer.com/)
