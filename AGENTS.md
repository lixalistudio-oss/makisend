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
├── index.ts                    # Hono entrypoint, Cloudflare bindings
├── config/
│   └── config.ts               # Typed Config object built from Bindings
├── core/                       # Shared kernel
│   ├── errors.ts               # AppError and subclasses
│   ├── logger.ts               # Edge-compatible Pino logger
│   ├── crypto.ts               # AES-256-GCM encryption / decryption
│   └── html-sanitizer.ts       # HTML sanitization
├── db/
│   ├── schema.ts               # Drizzle schema (email_logs)
│   └── connection.ts           # drizzle(db) factory
├── middleware/
│   ├── api_key.middleware.ts   # API key authentication (TODO stub)
│   ├── config.middleware.ts    # Injects Config into Hono context
│   ├── error.handler.ts        # Global error handler
│   └── request_logger.middleware.ts # Request logging
└── send-email/                 # Business module (barrel export via index.ts)
    ├── index.ts
    ├── send-email.controller.ts
    ├── send-email.dto.ts       # Zod schemas + types
    ├── send-email.service.ts   # Business logic
    ├── send-email.repository.ts # Drizzle/D1 persistence
    └── send-email.types.ts     # Interfaces / contracts

test/
├── setup.ts
└── unit/
    ├── middleware/             # Middleware tests
    └── send-emails/            # send-email module tests
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
| `SMTP_USER` | SMTP server username |
| `SMTP_PASSWORD` | SMTP password or app key |
| `SENDER_EMAIL` | Sender email address displayed to recipients |
| `HOST` | SMTP host (e.g. smtp.example.com) |
| `PORT` | SMTP port (465, 587, etc.) |
| `AES_256_KEY` | 64-character hex AES-256 key (`openssl rand -hex 32`) |
| `API_KEY` | API key for securing `/send-email` (auth implementation is TODO) |

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

- **API key authentication**: `src/middleware/api_key.middleware.ts` is in place but its implementation is marked **TODO**. For now it lets all requests through. To implement later with:
  - header `x-api-key: <API_KEY>`, or
  - header `Authorization: Bearer <API_KEY>`.
- **Encryption**: recipient email address is encrypted with AES-256-GCM before database storage.
- **HTML sanitization**: HTML content is cleaned with `sanitize-html` before sending.
- **Verified TLS**: SMTP connections use `rejectUnauthorized: true`.
- **Strict validation**: payloads are validated with Zod (`strict()` blocks unexpected fields).

### Current security limitations

- **No rate limiting**: a client with a valid API key could spam requests without a ceiling. Implement with Cloudflare KV, D1, or Workers Analytics Engine for distributed rate limiting.
- **Single global API key**: no multi-key / scopes / rotation management yet.
- **No webhook / signature**: no request origin verification beyond the API key.
- **No dedicated audit logs**: only Pino application logs are present.

## Technical notes

- **Forced IPv4** in nodemailer (`family: 4`) to avoid `workerd` network warnings
- **Verified TLS** (`rejectUnauthorized: true`) to prevent MITM attacks
- **Encryption** of recipient email address before database storage
- **HTML sanitization** of incoming content before sending
- No Node.js `Buffer`: use `Uint8Array`, `TextEncoder` / `TextDecoder`, and Web Crypto API

## Tests

- Framework: **Vitest**
- Config: `vitest.config.ts`
- Global setup: `test/setup.ts`
- Current coverage:
  - `POST /send-email` route (validation + 201 response)
  - Email service (mock transport, repository, encryption)
  - API key middleware tests are currently TODO
- Mocks are reset in `beforeEach`
- Run `pnpm test:run` before committing

## Database and migrations

- Database: **Cloudflare D1** (SQLite)
- ORM: **Drizzle**
- Schema: `src/db/schema.ts`
- Config: `drizzle.config.ts`
- Migrations: managed in the `drizzle/` folder
- Wrangler binding: `makisend_db`

## Deployment

Deployment is done via Wrangler:

```bash
pnpm deploy
```

Config: `wrangler.jsonc`

- Worker name: `makisend-poc`
- Entry point: `src/index.ts`
- Compatibility: `2026-07-10` with `nodejs_compat` flag
- Observability: logs enabled
- D1 binding: `makisend_db`

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

- `POST /send-email` endpoint (API key auth is TODO)
- Delivery via nodemailer + raw SMTP
- Encrypted logs stored in D1
- Unit tests for route / service / middleware
- GitHub Actions CI (lint + tests) on PRs to `main` and `dev`
- Deployment test on Cloudflare Workers

### Internal MVP

- Endpoint security
- SMTP credentials management via D1 / seeding
- Monitoring and delivery metrics

### Public Beta MVP

- Message and job queues (Inngest or Cloudflare Queues)
- Scale and throughput management
- Deliverability improvements (anti-spam, SPF/DKIM/DMARC)

## Known limitations and constraints

### Serverless-related (from Excalidraw)

- **Limited execution time**: Cloudflare Workers have a per-request CPU limit. A long synchronous SMTP send can fail.
- **Cold start**: first invocation may experience additional latency.
- **Pricing**: cost can become high on large volumes or long executions.
- **Long connections are inefficient**: SMTP keeps a TCP connection; recreating it on every Worker request is not optimal.

### POC-related

- **Synchronous sending only**: the caller waits for the email to be sent before getting a response. No queue / retry yet.
- **Single SMTP provider**: SMTP credentials are global (`SMTP_USER`, `SMTP_PASSWORD`). No multi-provider or failover.
- **No rate limiting**: see Security section.
- **No retry**: if the SMTP server temporarily refuses the send, the call fails without retry.
- **No bounce / open / click tracking**: only send logs are stored.
- **D1 is a serverless SQLite database**: possible latency, not ideal for very high volumes without caching.
- **Deliverability**: SPF, DKIM, DMARC and IP reputation are not handled by the code; they depend on the SMTP provider and sender domain.

## Useful resources

- [Hono](https://hono.dev/)
- [Drizzle ORM](https://orm.drizzle.team/)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [nodemailer](https://nodemailer.com/)
