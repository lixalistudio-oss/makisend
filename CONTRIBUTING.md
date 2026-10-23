# Contributing to MakiSend

Thanks for taking the time to contribute. MakiSend is a self-hosted transactional email API on Cloudflare Workers: one `POST /send-email`, delivered through your own SMTP provider, with a dashboard to manage SMTP configurations, API keys, templates and logs.

This guide covers how to report a problem, propose a change, and get a pull request merged.

- [Ways to contribute](#ways-to-contribute)
- [Reporting a security issue](#reporting-a-security-issue)
- [Development set-up](#development-set-up)
- [Project layout](#project-layout)
- [Making a change](#making-a-change)
- [Code conventions](#code-conventions)
- [Tests](#tests)
- [Database migrations](#database-migrations)
- [Dashboard translations](#dashboard-translations)
- [Commits and pull requests](#commits-and-pull-requests)

---

## Ways to contribute

- **Report a bug**: open an issue with the *Bug report* template. Say what you sent, what you expected, and what happened (status code, error message, the email log entry). Never paste an API key, an SMTP password or an `ENCRYPTION_KEY`.
- **Suggest a feature**: open an issue with the *Feature request* template. Describe the problem first, then the solution you have in mind. Check the [Roadmap](README.md#roadmap) and [Known limitations](README.md#known-limitations-and-constraints): the item may already be planned.
- **Improve the docs**: typos, unclear steps and missing provider notes are welcome as small pull requests.
- **Write code**: pick an open issue, or open one before a large change so the approach can be agreed on before you spend time on it.

## Reporting a security issue

Do **not** open a public issue for a vulnerability. Use GitHub's private reporting instead: **Security → Report a vulnerability** on the repository. Include the affected version or commit, the steps to reproduce, and the impact you see. You will get an answer before anything is disclosed.

## Development set-up

Prerequisites:

- Node.js **22+**
- **pnpm 11** (`corepack enable && corepack prepare pnpm@11 --activate`)
- No Cloudflare account is needed to develop: D1, Queues and Workflows are simulated locally by Miniflare.

```bash
git clone https://github.com/lixalistudio-oss/makisend.git
cd makisend
pnpm install

# Local Worker secrets (wrangler dev reads .dev.vars, not .env)
cp backend/.env.example backend/.dev.vars
# set ENCRYPTION_KEY (openssl rand -hex 32) and BETTER_AUTH_SECRET (openssl rand -base64 32)

# Local D1 schema
cd backend
pnpm exec wrangler d1 migrations apply makisend_db --local

# Terminal 1: Worker API on http://localhost:8787
pnpm dev

# Terminal 2 (repository root): dashboard on http://localhost:4321
pnpm --filter frontend dev
```

Open `http://localhost:4321`: the first connection creates the administrator account.

Prefer containers? `docker compose up` starts the same stack (see [Development with Docker](README.md#development-with-docker)). A devcontainer is also provided in `.devcontainer/`.

More detail (configuration, debugging, pitfalls) lives in [`docs/DEVELOPER_GUIDE.md`](docs/DEVELOPER_GUIDE.md) and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Project layout

```
backend/    Cloudflare Worker: Hono API, D1 (Drizzle), Queues, Workflows
  src/<module>/   one folder per domain: controller, dto, service, repository, types, index
  src/core/       shared kernel: errors, logger, crypto, HTML sanitizer
  drizzle/        SQL migrations
  test/           unit, integration and e2e tests (Vitest)
frontend/   Astro + React dashboard (shadcn/ui), served by the same Worker
  src/i18n/       UI dictionaries, one folder per language
docs/       architecture, developer guide, self-hosting and update guides
```

## Making a change

1. Fork the repository and create a branch from `main`, named after the change: `feat/webhooks`, `fix/smtp-starttls-timeout`, `docs/mailgun-preset`.
2. Keep the change focused. A bug fix does not need a refactor next to it; open a separate pull request for that.
3. Add or update tests for what you changed.
4. Run the checks below before pushing.
5. Open a pull request against `main` and fill in the template.

## Code conventions

The backend follows a NestJS-inspired modular layout on top of Hono:

- **Controllers** only handle HTTP: validate the DTO, call the service, shape the response. They never import `nodemailer` or `drizzle`.
- **Services** hold the business logic and know nothing about Hono, so they are testable on their own.
- **Repositories** implement an interface (e.g. `IEmailRepository`) so persistence stays replaceable.
- **DTOs** are Zod schemas in `*.dto.ts`, `strict()` so unexpected fields are refused. They are both the API contract and the TypeScript types.
- **Dependencies are injected by hand**, through constructors or module factories. Read `c.env` only in the entrypoint and factories, then pass a typed `Config`.
- **Errors** are `AppError` subclasses (status code + message). **Logs** go through the Pino logger.
- **Worker runtime**: no Node.js `Buffer` in new code; use `Uint8Array`, `TextEncoder` / `TextDecoder` and the Web Crypto API.

Style: strict TypeScript, double quotes and semicolons in the backend. `pnpm lint:fix` fixes most of it.

Security rules that a pull request must not weaken:

- Recipients, bodies, attachments and SMTP credentials are stored **AES-256-GCM encrypted**.
- Incoming HTML is **sanitized** before sending.
- SMTP TLS certificates are **verified** (`rejectUnauthorized: true`).
- No secret is hard-coded, logged, or returned by the API.

## Tests

Run from `backend/`:

```bash
pnpm lint              # ESLint
pnpm exec tsc --noEmit # typecheck
pnpm test:run          # Vitest, once
```

And from the repository root:

```bash
pnpm --filter frontend build
cd frontend && pnpm exec tsc --noEmit -p .   # the build does not typecheck
```

CI runs lint, typecheck, tests and the frontend build on every pull request; it must be green before a merge.

Tests are typed: no `as unknown as` casts and no hand-rolled mocks of whole libraries. Use the helpers in `backend/test/helpers` and `backend/test/mocks`, and reset mocks in `beforeEach`.

## Database migrations

- The schema lives in `backend/src/db/schema.ts`.
- Generate a migration with `pnpm db:generate` (Drizzle Kit) from `backend/`, review the SQL, and commit it with the schema change.
- Migrations must be **additive**: never drop a table or a column that a deployed instance still reads, never edit a migration that was already released. Self-hosted instances apply them in order on update.
- Apply locally with `pnpm exec wrangler d1 migrations apply makisend_db --local`.

## Dashboard translations

The dashboard is available in English and French. No user-visible string lives in a component: every label goes through `t("feature.key")` from `@/i18n`.

- English (`frontend/src/i18n/en/`) is the reference. Every other language is typed on its keys, so a missing translation fails `tsc --noEmit`.
- A new string: add the key to the English file of the feature **and** to every other language, with a real translation.
- A new language: add one row to `LANGUAGES` in `frontend/src/i18n/config.ts`, copy the `en/` folder to the new code, translate it, and register it in `frontend/src/i18n/index.ts`.
- Brand names, code samples, HTTP paths and API field names are not translated.

## Commits and pull requests

- Commits follow [Conventional Commits](https://www.conventionalcommits.org/): `feat(send-email): ...`, `fix(smtp-config): ...`, `docs: ...`, `test: ...`, `refactor: ...`.
- Pull requests, issues, code comments and docs are written in **English**.
- Fill in the pull request template: what changed and why, the type of change, and the checks you ran.
- Update `AGENTS.md`, `README.md` or `docs/` when you change the structure, a convention, an endpoint or a configuration variable.
- A maintainer reviews the pull request; expect questions and change requests, not a silent merge.
