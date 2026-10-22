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
│   ├── transport-resolver.ts   # Per-event SMTP transport factory
│   ├── error-classifier.ts     # Permanent/transient verdicts + human-readable messages
│   └── send-email.types.ts     # Interfaces / contracts
├── idempotency/                # HTTP Idempotency-Key for POST /send-email
├── smtp-config/                # Per-user SMTP credentials (encrypted in D1)
├── templates/                  # Email templates with {{variable}} placeholders
│   ├── index.ts                # Barrel export
│   ├── templates.types.ts      # Contracts / repository interface
│   ├── templates.dto.ts        # Create/Update Zod schemas
│   ├── templates.repository.ts # Drizzle/D1 persistence
│   ├── templates.service.ts    # CRUD + ownership checks
│   ├── templates.controller.ts # /templates routes (session auth)
│   └── template-renderer.ts    # extractVariables / renderTemplate / renderHtmlTemplate
└── workflows/                  # Cloudflare Workflows (durable async orchestration)
    ├── index.ts                # Barrel export
    ├── send-email.flow.ts      # Durable steps + 3 retries + dead-letter publication
    └── send-email.workflow.ts  # SendEmailWorkflow entrypoint (id-only payload)

test/
├── setup.ts
├── helpers/d1-setup.ts
├── integration/full-flow.test.ts
└── unit/
    ├── api-keys/ auth/ config/ dashboard/ email-logs/
    ├── send-email/             # error classifier, transport resolver, controller
    ├── idempotency/            # replay / conflict / 5xx retry behaviour
    ├── workflows/              # send flow retries, DLQ, classifier integration
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
| `AES_256_KEY` | 64-character hex AES-256 key (`openssl rand -hex 32`) |
| `BETTER_AUTH_SECRET` | Better Auth signing secret |
| `BETTER_AUTH_URL` | Backend URL of the Worker (e.g. `http://localhost:8787`) |
| `FRONTEND_URL` | Frontend origin allowed for CORS / redirects |
| `PORT` | SMTP port for nodemailer (`465`, `587`, ...; also a `wrangler.jsonc` var) |

Not environment variables anymore:

- **SMTP credentials** (`SMTP_USER`, `SMTP_PASSWORD`, `SENDER_EMAIL`, `HOST`): stored per user, encrypted in D1, managed through the `smtp-config` module.
- **`API_KEY`**: API keys are per user, created via the `api-keys` module (Better Auth), and sent as `x-api-key` or `Authorization: Bearer`.

These variables are mapped in `src/index.ts` via the `Bindings` type, transformed into a typed `Config` via `createConfig()`, and injected into services at runtime.

## Target architecture inspired by NestJS

Even though the runtime remains **Hono** (not NestJS), the code organization is inspired by NestJS architectural principles:

- **Modules**: each business domain (e.g. `send-email`) is a cohesive module exporting its controllers, services, repositories and DTOs via an `index.ts` barrel file.
- **Controllers**: `*.controller.ts` files contain only HTTP code — routing, input validation (DTO), and response formatting.
- **Providers / Services**: business logic lives in services. They know nothing about the web framework.
- **Repositories**: persistence is isolated behind an interface / contract (`IEmailRepository`). The concrete repository can be implemented with Drizzle/D1 today and replaced later without touching the service.
- **DTOs / Schemas**: Zod validation schemas are extracted into `*.dto.ts` files next to the controller. They serve both as API contracts and TypeScript types (`z.infer`).
- **Manual dependency injection**: Hono has no native IoC container. Dependencies are injected through constructors (`new Service(new Repository(...), config)`), or via simple factory functions (`createSendEmailModule(env)`).
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
- **Encryption**: recipient email address is encrypted with AES-256-GCM before database storage.
- **HTML sanitization**: HTML content is cleaned with `sanitize-html` before sending.
- **Template ownership**: the `templateId` branch of `POST /send-email` checks that the template belongs to the API key's user (a foreign or unknown id answers the same `404` so ids cannot be probed).
- **Verified TLS**: SMTP connections use `rejectUnauthorized: true`.
- **Strict validation**: payloads are validated with Zod (`strict()` blocks unexpected fields).

### Current security limitations

- **No rate limiting**: a client with a valid API key could spam requests without a ceiling. Implement with Cloudflare KV, D1, or Workers Analytics Engine for distributed rate limiting.
- **No webhook / signature**: no request origin verification beyond the API key.
- **No dedicated audit logs**: only Pino application logs are present.

## Technical notes

- **Forced IPv4** in nodemailer (`family: 4`) to avoid `workerd` network warnings
- **Workflow steps return primitives**: a `step.do` callback must never return an object — the Workflows runtime then emits a false "code had hung" cancellation right after the run (workerd#6925 / workers-sdk#14959); multi-value steps return a `JSON.stringify` string that the run parses back
- **Verified TLS** (`rejectUnauthorized: true`) to prevent MITM attacks
- **Encryption** of recipient email address before database storage
- **HTML sanitization** of incoming content before sending
- **Templates render at request time**: `templateId` payloads are resolved (load → missing-variable check → render → HTML-escape) into the same inline shape before enqueueing, so the queue, workflow and SMTP layer never learn that templates exist; missing variables fail fast with `400` and a list of names
- No Node.js `Buffer`: use `Uint8Array`, `TextEncoder` / `TextDecoder`, and Web Crypto API

## Tests

- Framework: **Vitest**
- Config: `vitest.config.ts`
- Global setup: `test/setup.ts`
- Current coverage:
  - `POST /send-email` route (validation + 202 response, inline and `templateId` branches: rendering, missing variables → 400, foreign template → 404, mixed payload → 400)
  - Email service (mock transport, repository, encryption)
  - Template renderer (`extractVariables` / `renderTemplate` / `renderHtmlTemplate` with HTML escaping)
  - Retry pipeline: error classifier, workflow retries, DLQ publication, queue consumer dedup
  - HTTP idempotency: replay, body-mismatch conflict, in-progress conflict, 5xx retry
  - API key middleware (401/403 + context wiring)
- Mocks are reset in `beforeEach`
- Run `pnpm test:run` before committing

## Database and migrations

- Database: **Cloudflare D1** (SQLite)
- ORM: **Drizzle**
- Schema: `src/db/schema.ts`
- Config: `drizzle.config.ts`
- Migrations: managed in the `drizzle/` folder
- Wrangler binding: `makisend_db`
- Email bodies live in `email_contents` (encrypted, keyed by `email_logs.internalId`);
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
- Static assets: `../frontend/dist` (Astro build output) — the Worker serves the
  frontend and the API on the **same origin**, so there is no Cloudflare Pages
  project and no CORS between UI and API

## CI / GitHub Actions

The workflow `.github/workflows/ci.yml` triggers on every pull request to `main` or `dev`.

Steps run:

1. Checkout code
2. Setup pnpm and Node.js 22
3. `pnpm install --frozen-lockfile`
4. `pnpm lint`
5. `pnpm test:run`

## Roadmap (from Excalidraw design)

### POC (current)

- `POST /send-email` endpoint with per-user API key auth (Better Auth)
- Email templates: `/templates` CRUD (session auth) + `templateId`/`variables` branch on `POST /send-email` (API key auth), rendered at request time before enqueueing; frontend page at `/dashboard/templates` with live preview
- Async delivery pipeline: Cloudflare Queues → SendEmailWorkflow → SMTP
- Delivery via nodemailer + raw SMTP
- Retry loop: 1 initial SMTP attempt + 3 retries 30s apart; permanent failures (auth, TLS, DNS, config, 5xx) stop immediately, transient failures go to the DLQ after the budget with a human-readable reason in D1
- Encrypted logs + encrypted email bodies stored in D1
- `Idempotency-Key` support on `POST /send-email` (24h replay window)
- Unit tests for route / service / middleware
- GitHub Actions CI (lint + tests) on PRs to `main` and `dev`
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
- **No rate limiting**: see Security section.
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
