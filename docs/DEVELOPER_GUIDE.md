# MakiSend — Developer & Agent Guide

> Companion to `ARCHITECTURE.md`. This guide is task-oriented: get the project
> running, make a change safely, test it, debug it, and know what to avoid.
>
> French version: `DEVELOPER_GUIDE.fr.md`.

---

## 1. Prerequisites

- Node.js **22+**
- **pnpm 11** (`corepack enable && corepack prepare pnpm@11 --activate`)
- A Cloudflare account with Workers, D1, Queues and Workflows (only for
  deploying; local development is fully simulated by Miniflare)
- An SMTP provider account with host/username/password/sender address
  (SendGrid, Resend, Mailgun, Postmark, Amazon SES, …)
- Optional: Docker + Docker Compose, for the containerized dev stack

---

## 2. First run

```bash
# From the repo root — installs both workspace packages
pnpm install

# Local Worker secrets/vars
cp backend/.env.example backend/.dev.vars
# edit backend/.dev.vars (see §3)

# Create the local D1 schema
cd backend
pnpm exec wrangler d1 migrations apply makisend_db --local

# Terminal 1 — Worker API on http://localhost:8787
pnpm dev

# Terminal 2 — Astro dashboard on http://localhost:4321
pnpm --filter ./frontend dev
```

> `wrangler dev` reads **`backend/.dev.vars`**, not `.env`. The `.env.example`
> header is legacy; use `.dev.vars` for anything the Worker needs locally.
> `backend/.dev.vars` is git-ignored.

Open `http://localhost:4321`, register the **first** user (registration is
closed afterwards), then in the dashboard:

1. **SMTP Config** → create a config (host, username, password, sender email).
2. **API Keys** → create a key linked to that SMTP config. Copy the `mk_...`
   value immediately; it is shown only once.
3. **Templates** (optional) → create one in the visual editor or paste a React Email TSX component with `{{variables}}`.
4. Send a test email with `curl` (§4).

---

## 3. Configuration

### 3.1 Worker bindings

| Name | Where | Notes |
|---|---|---|
| `AES_256_KEY` | secret / `.dev.vars` | 64 hex chars; `openssl rand -hex 32` |
| `BETTER_AUTH_SECRET` | secret / `.dev.vars` | long random string |
| `BETTER_AUTH_URL` | secret / `.dev.vars` | Worker URL (`http://localhost:8787` locally) |
| `FRONTEND_URL` | secret / `.dev.vars` | dashboard origin (`http://localhost:4321` locally) |
| `PORT` | `wrangler.jsonc` var | SMTP port; `"465"` today (string in Wrangler) |
| `makisend_db` | `wrangler.jsonc` | D1 binding |
| `SEND_EMAIL_QUEUE` | `wrangler.jsonc` | Queue producer |
| `SEND_EMAIL_WORKFLOW` | `wrangler.jsonc` | Workflow binding |
| `ASSETS` | `wrangler.jsonc` | `../frontend/dist` |

**Do not** add SMTP credentials or API keys as Worker secrets: they are
per-user rows in D1, encrypted with `AES_256_KEY`.

`backend/.dev.vars` currently still contains legacy `SMTP_USER`,
`SMTP_PASSWORD`, `SENDER_EMAIL` and `HOST` entries. They are ignored by the
code; delete them to avoid confusion.

### 3.2 Config validation

`createConfig` (`backend/src/config/config.ts`) validates:

- `AES_256_KEY` is present and matches `^[0-9a-fA-F]{64}$`.
- `makisend_db` is present.

It does **not** validate `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
`FRONTEND_URL` or `PORT`. Missing auth values surface later as opaque Better
Auth failures; a missing `PORT` can make nodemailer fall back to 465.

### 3.3 Frontend

- `frontend/astro.config.mjs` reads `BACKEND_URL` (default
  `http://localhost:8787`; Docker sets `http://backend:8787`).
- Production needs no API base URL: the Worker serves UI and API on the same
  origin and `fetchApi` uses a relative path.

---

## 4. API quick reference

### 4.1 Send an inline email

```bash
curl -i http://localhost:8787/send-email \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mk_your_key" \
  -d '{
    "to": "you@example.com",
    "subject": "Hello from MakiSend",
    "text": "This is the plain-text body (at least 10 chars).",
    "html": "<p>This is the <strong>HTML</strong> body.</p>"
  }'
```

`202 {"success":true,"message":"Email queued"}` means the message is in the
queue — not delivered. Poll `GET /email-logs` or watch `wrangler dev` logs.

`x-api-key: mk_your_key` is equivalent to the `Authorization` header.

### 4.2 Send with a template

```bash
curl -i http://localhost:8787/send-email \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mk_your_key" \
  -d '{
    "to": "you@example.com",
    "templateId": "template_id_from_dashboard",
    "variables": { "username": "Gedeon", "orderId": 42 }
  }'
```

Rules:

- Missing variable → `400` listing the names.
- Unknown/foreign template → the same `404`.
- Mixing inline fields with `templateId` → `400`.
- Variable values may be string, number or boolean; they are stringified.

### 4.3 Dashboard endpoints (session cookie)

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/smtp-config` | list / create |
| GET/PUT/DELETE | `/smtp-config/:id` | read / update / delete |
| GET/POST | `/api-keys` | list / create (body: `smtpConfigId`, optional `name`) |
| DELETE | `/api-keys/:id` | revoke |
| GET/POST | `/templates` | list / create |
| GET/PUT/DELETE | `/templates/:id` | read / update / delete |
| POST | `/templates/:id/preview` | render the saved template with sample variables |
| GET | `/email-logs?limit=&cursor=&status=&smtpConfigId=&to=` | paginated logs |
| GET | `/email-logs/:id` | one log + history |
| GET | `/dashboard/stats?days=7` | totals + success rate |
| GET | `/dashboard/by-config?days=7` | per SMTP config |
| GET | `/dashboard/recent?limit=20` | recent sends |
| GET | `/dashboard/errors?days=7&limit=10` | grouped failures |

Auth routes live under `/api/auth/*` (Better Auth). Sign-up is closed once a
user exists.

---

## 5. Commands

There is **no root `dev`/`test`/`lint` script**. Run backend commands from
`backend/` or with a filter.

| Task | Command |
|---|---|
| Install everything | `pnpm install` (root) |
| Worker dev server | `cd backend && pnpm dev` |
| Frontend dev server | `pnpm --filter ./frontend dev` |
| Build frontend | `pnpm --filter ./frontend build` |
| Lint backend | `cd backend && pnpm lint` |
| Auto-fix lint | `cd backend && pnpm lint:fix` |
| Tests (watch) | `cd backend && pnpm test` |
| Tests (once) | `cd backend && pnpm test:run` |
| Tests UI | `cd backend && pnpm test:ui` |
| Coverage | `cd backend && pnpm test:coverage` |
| Regenerate Worker types | `cd backend && pnpm cf-typegen` |
| Generate a migration | `cd backend && pnpm db:generate` |
| Apply migrations (local) | `cd backend && pnpm exec wrangler d1 migrations apply makisend_db --local` |
| Apply migrations (remote) | `cd backend && pnpm exec wrangler d1 migrations apply makisend_db --remote` |
| Deploy | `cd backend && pnpm deploy` (build the frontend first) |
| Tail production logs | `cd backend && pnpm exec wrangler tail` |
| Legacy user bootstrap | `cd backend && pnpm user:create` |

> `pnpm --filter backend ...` does **not** match: the package is named
> `makisend-poc`. Use `pnpm --filter ./backend ...`, `cd backend`, or
> `pnpm --filter makisend-poc ...`.

### 5.1 Docker

```bash
pnpm docker:build
pnpm docker:up        # API :8787, UI :4321
pnpm docker:down
pnpm docker:test      # docker compose run --rm backend pnpm test:run
pnpm docker:lint
pnpm docker:migrate
```

Do not run the host dev server at the same time as the container (port 8787).
Local D1 state persists in `backend/.wrangler`.

---

## 6. Testing

### 6.1 Layout

```
backend/test/
├── setup.ts                     # clears mocks before each test
├── helpers/d1-setup.ts          # real Miniflare D1 + migrations
├── mocks/cloudflare-workers.ts  # WorkflowEntrypoint stub for Node
├── integration/full-flow.test.ts
└── unit/
    ├── api-keys/ auth/ config/ core/ dashboard/ email-logs/
    ├── middleware/ queue/ send-email/ send-emails/ settings/
    ├── smtp-config/ templates/ workflows/
```

Current baseline: **30 files / 308 tests pass** in ~40 s with
`pnpm test:run`. Lint and `pnpm exec tsc --noEmit` pass.

CI does not run `tsc`; run it manually before claiming typechecking is clean.

### 6.2 How tests are wired

- `vitest.config.ts` aliases `@/` via `vite-tsconfig-paths` and replaces
  `cloudflare:workers` with `test/mocks/cloudflare-workers.ts`.
- `createTestD1()` starts a real Miniflare `workerd` process with D1, reads
  every `drizzle/*.sql`, splits on `--> statement-breakpoint`, converts
  backticks to double quotes and executes each statement. New migrations are
  picked up automatically.
- Always `cleanupTestD1(mf)` in `afterEach`/`afterAll`.
- Tests that exercise the controller mount it on a fresh `Hono` with
  `errorHandler`, and inject `userId`/`apiKeyId`/`smtpConfigId` through a
  middleware that mirrors `apiKeyMiddleware`.
- Workflow tests use a stub `WorkflowStep` that executes callbacks and can
  capture per-step configs (used to assert `retries: { limit: 0 }`).

### 6.3 What to test when you change something

| Change | Minimum tests |
|---|---|
| DTO / validation | invalid, missing, extra field, boundary lengths |
| Controller | status code, queue payload, pending log, error path |
| Template renderer | extraction order, whitespace, malformed markers, HTML escaping, missing/prototype variables, rendered caps |
| Template editor save | DTO accepts `format` + `editorJson`/`source`, requires JSON for `react-email` and source for `react-email-code`, preview route renders saved content |
| Workflow step | history sequence, returned primitive shape, step config |
| Error classifier | `responseCode`, SMTP status in message, `err.code`, message token, default |
| Retry decision | requeue + backoff, cycle cap, permanent, missing queue, re-enqueue failure |
| Queue consumer | ack after create, retry delay, final attempt history, instance id |
| Repository | filters, pagination, ownership scoping, history attachment |
| Auth | 401 missing, 403 invalid, session wiring |
| Crypto | round-trip, fresh IV, empty string, malformed key |

### 6.4 Adding a test file

1. Put it under `backend/test/unit/<module>/`.
2. Import `{ describe, it, expect, vi }` from `vitest` (globals exist but the
   suite is explicit).
3. Use `createTestD1`/`cleanupTestD1` only when you need real SQL behavior.
4. Run `pnpm test:run` from `backend/`.

---

## 7. Database workflow

Schema: `backend/src/db/schema.ts`. Migrations: `backend/drizzle/`.

```bash
cd backend
# 1. Edit src/db/schema.ts
pnpm db:generate                  # creates drizzle/000N_*.sql + meta snapshot
pnpm exec wrangler d1 migrations apply makisend_db --local
pnpm test:run                     # Miniflare helper loads the new SQL
```

Rules:

- Never edit an already-applied migration. Add a new one.
- Migration SQL is generated with backticks; the test helper converts them to
  double quotes for D1. Keep the generated format.
- D1 has a **100 bound-parameter limit per query** — see
  `MAX_PAGE_SIZE = 100` in `email-logs.repository.ts`. Avoid `inArray` with
  unbounded arrays.
- Timestamps: Better Auth tables use integer `timestamp_ms`; `email_logs` and
  `email_histories` use ISO **text**. Do not mix the two in a comparison.
- Foreign keys: `email_logs.userId` deliberately has no FK; deleting a user is
  handled by Better Auth's `beforeDelete` hook. `email_histories.emailId` has
  no FK either — remember to clean up if you add user deletion logic.
- When adding an encrypted column, encrypt/decrypt in the service, never in the
  repository, and add the field to `crypto.test.ts` coverage if it has special
  handling.

---

## 8. Adding a feature

### 8.1 New backend module (CRUD pattern)

Use `templates/` as the template:

1. `src/<module>/<module>.types.ts` — record, input/update input, repository
   interface.
2. `src/<module>/<module>.dto.ts` — Zod schemas with `.strict()` and caps.
3. `src/<module>/<module>.repository.ts` — Drizzle only; implement the
   interface.
4. `src/<module>/<module>.service.ts` — business rules, ownership checks
   (`AppError(404)` for missing, `403` for foreign), encryption if needed.
5. `src/<module>/<module>.controller.ts` — `zValidator`, read `c.get("userId")`,
   call the service, return JSON.
6. `src/<module>/index.ts` — barrel export.
7. Wire it in `src/index.ts`:
   - add nullable fields to `deps`;
   - construct the repository in `initDb`;
   - construct the service in `initServices`;
   - mount the controller with a getter;
   - add `sessionMiddleware` (or `apiKeyMiddleware` for machine endpoints).
8. Add the path to the Astro dev proxy in `frontend/astro.config.mjs` if the
   frontend will call it.
9. Add unit tests (service + HTTP) and, if it touches D1, a Miniflare test.

### 8.2 New route on an existing module

- Controller only: validate → call service → return.
- Never instantiate a repository in the controller.
- Never read `c.env` in a controller; use `c.get("appConfig")` or the injected
  service.
- Throw `AppError` for expected failures; do not return ad-hoc error shapes.

### 8.3 New table + module

1. Add the Drizzle table and indexes.
2. `pnpm db:generate` + apply locally.
3. Add deletion behavior deliberately (FK cascade vs application-level purge).
4. If user-owned, add `userId` + an index on it.
5. If encrypted, encrypt in the service and decrypt on read.
6. Add the table to `backend/test/helpers/d1-setup.ts`? Nothing to do — it
   loads all migrations.

### 8.4 Changing the send pipeline

Order of concerns:

1. **DTO** (`send-email.dto.ts`) — request shape and caps.
2. **Controller** — template resolution, pending log, queue payload.
3. **Types** (`send-email.types.ts`) — queue message shape.
4. **Queue consumer** — instance id, ack/retry.
5. **Workflow** — steps, history rows, primitive return values.
6. **Classifier** — permanent/transient + friendly message.
7. **Transport resolver / transport** — config lookup and nodemailer options.

Hard rules:

- **Never add automatic retries to the SMTP step.** SMTP is not idempotent.
  Keep `retries: { limit: 0 }`.
- **Steps must return primitives.** Return a string; if you need multiple
  values, `JSON.stringify` them and parse in the next step. Returning an object
  triggers the workerd false "hung" cancellation.
- **One SMTP attempt per run.** Retries belong to the queue-cycle ladder.
- **Write a history row for every terminal path**, including abandonment and
  DLQ exhaustion, so the dashboard never loses an email silently.
- **Keep `FINAL_ATTEMPT` in sync** with the queue's `max_retries` in
  `wrangler.jsonc`.
- **Keep the instance id format** `${emailId}-${queueCycles}`; Workflow ids
  allow only `[a-zA-Z0-9-_]`.
- **Do not put secrets or full recipient lists in logs.** Recipient addresses
  are already logged in plaintext — do not make it worse.

### 8.5 Adding a workflow step

```ts
const value = await step.do("my-step", async () => {
  // work
  return "a primitive"; // string/number/boolean/null
});
```

- Keep side effects idempotent where possible; steps may be retried.
- If the step is the SMTP send, set `retries: { limit: 0 }`.
- If it must fail the run into the classifier, throw a plain `Error` (optionally
  with a `code`) or an `AppError`; the workflow catches and classifies it.
- Update the history timeline and the workflow tests.

### 8.6 Adding a template variable feature

The renderer is shared by the controller, the preview endpoint, and the
frontend live preview. If you change the syntax:

1. Update `VARIABLE_PATTERN` in `backend/src/templates/template-renderer.ts`.
2. Update the duplicated regex/escaping in `frontend/src/components/templates-layout.tsx`.
3. Update `template-renderer.test.ts`.
4. Decide escaping per field: subject/text literal, HTML escaped.
5. Keep the missing-variable check on `Object.prototype.hasOwnProperty`
   (prototype names must not pass).
6. `renderTemplateContent` re-caps the rendered output; keep the preview
   endpoint using it.
7. The visual builder stores `format: "react-email"`, an `editorJson` envelope
   (`{ version: 2, theme, content }`), and the exported `html`/`text`. It mounts
   the full `@react-email/editor` UI: canvas, inspector (body/container/node
   colors, spacing, borders), Basic/Minimal themes, and Export HTML. Code mode
   stores `format: "react-email-code"`, `source`, and the HTML/text compiled by
   the browser worker. The Worker must not execute pasted TSX.

### 8.7 Frontend page

- Add an Astro page under `frontend/src/pages/dashboard/` that mounts a React
  layout with `client:load`.
- Wrap protected content in `SessionGuard` (client-side only; the API is the
  real gate).
- Use `fetchApi` from `@/lib/api` so cookies are sent.
- Add the API path to the dev proxy in `frontend/astro.config.mjs`.
- Follow existing shadcn/Base UI components; do not introduce a new UI library.
- The template page is the exception: it imports `@react-email/editor` in a
  React island and persists the exported HTML/text plus the builder envelope.
  Visual mode includes the inspector sidebar, theme switcher, and Export HTML.
  Code mode transpiles pasted TSX with Sucrase in a sandboxed Web Worker,
  renders it with `react-email`, and persists `source` plus the compiled
  HTML/text. Never run the editor or user-pasted TSX in the Worker.
- There is no frontend test/lint setup; at minimum run `pnpm --filter
  ./frontend build` and exercise the page manually.

---

## 9. Debugging

### 9.1 Local

- `wrangler dev` prints Pino JSON lines to the terminal.
- D1 state: `backend/.wrangler/state/v3/d1`.
- Inspect the DB:
  `cd backend && pnpm exec wrangler d1 execute makisend_db --local --command "select * from email_logs order by created_at desc limit 10"`
- Queue/workflow are simulated; a workflow run appears in the dev logs with its
  step names.
- If the frontend gets `401`, check the session cookie and `FRONTEND_URL`.
- If the API works with `curl` but not from the browser, check CORS
  (`Authorization` is allowed; `x-api-key` is **not** in `allowHeaders`).

### 9.2 Production

```bash
cd backend
pnpm exec wrangler tail                      # live logs
pnpm exec wrangler d1 execute makisend_db --remote --command "select ..."
pnpm exec wrangler queues list
pnpm exec wrangler workflows list
```

The dashboard's email detail shows the history timeline (`received`,
`processing`, `cleaned`, `sent`, `attempt_failed`, `failed`). The `error`
column explains why a send stopped.

### 9.3 Symptom → cause

| Symptom | Likely cause / fix |
|---|---|
| `500 AES_256_KEY ...` on every request | Missing/malformed key. Use exactly 64 hex chars. |
| `403 Invalid API Key` | Key revoked/typo; `mk_` prefix; check `x-api-key` or Bearer. |
| `403 API key has no SMTP configuration` | Create an SMTP config and a key linked to it. |
| `403 Registration is closed` | A user already exists. Sign in, or wipe the local D1. |
| Email stuck at `received`/`processing` | Workflow/queue binding missing or consumer not running locally. |
| `attempt_failed` repeating, then `failed` after ~1h | Transient error hit the 5-cycle cap. Inspect the last error. |
| `failed` immediately with credentials message | `EAUTH`/`535` — wrong SMTP username/password or provider requires an app password. |
| "Outbound port 25 is blocked" | Workers block port 25. Use 465 (implicit TLS) or 587 (requires code change — `secure` is hardcoded `true`). |
| TLS error on 587 | `SmtpEmailTransport` hardcodes `secure: true`; 587 needs `secure: false` + STARTTLS. |
| Missing SMTP config keeps retrying 5 times | Known: `AppError(404)` has no code → classifier defaults to transient. |
| Email delivered twice | At-least-once pipeline; a crash between SMTP success and step 5 can re-enqueue. No dedup today. |
| `400 Validation failed` | Zod `.strict()` rejected an extra field or a length cap. |
| `400 Missing template variables` | Provide every `{{name}}` used in subject/html/text. |
| `404 Template not found` | Wrong id or belongs to another user (intentional anti-probing). |
| Queue send fails with size error | Rendered template exceeded the 128 KB queue limit; `renderTemplateContent` should reject it earlier. |
| Logs page pagination skips rows | Known cursor bug (`:` in the ISO timestamp). Fix `encode/decodeCursor` before relying on pagination. |
| Dashboard success rate looks wrong | Known: success+failure double count, pending in denominator. |
| `GET /smtp-config` exposes passwords | Known security issue; do not build UI that relies on it, and fix before production. |
| `pnpm --filter backend` does nothing | Package is named `makisend-poc`; use `./backend`. |
| `wrangler` types out of date | `pnpm cf-typegen`; do not hand-edit `worker-configuration.d.ts`. |

### 9.4 Wiping local state

```bash
cd backend
rm -rf .wrangler
pnpm exec wrangler d1 migrations apply makisend_db --local
```

Then register the first user again. Any local API keys/SMTP configs are gone.

---

## 10. Deployment

### 10.1 Manual

```bash
pnpm --filter ./frontend build      # required: Worker serves frontend/dist
cd backend
pnpm exec wrangler d1 migrations apply makisend_db --remote
pnpm exec wrangler queues create makisend-send-email   # first time only
pnpm deploy
```

Secrets (once per environment):

```bash
cd backend
echo "<64 hex chars>" | pnpm exec wrangler secret put AES_256_KEY
echo "<random>"       | pnpm exec wrangler secret put BETTER_AUTH_SECRET
echo "https://<worker-url>" | pnpm exec wrangler secret put BETTER_AUTH_URL
echo "https://<worker-url>" | pnpm exec wrangler secret put FRONTEND_URL
```

`BETTER_AUTH_URL` and `FRONTEND_URL` must be the Worker URL because UI and API
share an origin. Preview uses the same secret names on the preview Worker.

### 10.2 CI/CD

- `.github/workflows/ci.yml` — PRs to `main`/`dev`: backend lint + tests. No
  `tsc`, no frontend checks.
- `.github/workflows/deploy.yml` — **every push to any branch deploys to
  production**; PRs from the same repo also get a preview deploy.
  - Build job: lint, test, build frontend, upload artifact.
  - Production job: **deletes and recreates the production D1 database**,
    rewrites `database_id` in `wrangler.jsonc`, applies migrations, ensures the
    queue, deploys, checks secrets, comments the URL on the PR.
  - Preview job: same for `makisend-db-preview`, preview queue/workflow.
- This means **production data is disposable** and **every branch can
  overwrite production**. Do not store real data until this is changed.

### 10.3 Pre-deploy checklist

- [ ] `cd backend && pnpm lint`
- [ ] `cd backend && pnpm test:run`
- [ ] `pnpm --filter ./frontend build`
- [ ] Migration generated and committed (`backend/drizzle/*.sql` + meta)
- [ ] New bindings/secrets documented and created
- [ ] Queue/workflow names unchanged or `wrangler.jsonc` updated consistently
- [ ] No secrets or `.dev.vars` staged
- [ ] `wrangler.jsonc` production `database_id` is the intended one (the deploy
      workflow rewrites it)

---

## 11. Conventions

From `AGENTS.md` and the codebase:

- Strict TypeScript; double quotes; semicolons.
- Controllers: HTTP only. Services: business logic. Repositories: persistence.
- DTOs: Zod schemas + `z.infer`; `.strict()` on write payloads.
- Errors: `AppError(status, message)` and subclasses. Do not leak raw errors.
- Logs: `pinoLogger`, structured objects, no Node transports.
- No `Buffer`: use `Uint8Array`, `TextEncoder`/`TextDecoder`, Web Crypto.
- No comments unless they explain *why* (the codebase uses explanatory
  comments for non-obvious decisions).
- Imports use the `@/` alias.
- `consistent-type-imports` is enforced by ESLint: use `import type`.
- `no-explicit-any` is a warning; avoid it, and when unavoidable add the
  eslint-disable comment like the existing code.

### 11.1 Anti-patterns

- Instantiating a repository in a route.
- Mixing nodemailer/SMTP logic with persistence.
- Reading `c.env` in a controller instead of the injected service/config.
- Returning an object from `step.do`.
- Adding retries to the SMTP step.
- Storing secrets in plaintext columns.
- Adding unbounded `inArray` queries (D1 parameter limit).
- Trusting `email_logs.apiKeyId` to still exist (it is `SET NULL`).
- Assuming templates are visible downstream (they are rendered before enqueue).

---

## 12. Reusing / forking this project

### 12.1 What is genuinely reusable

- The HTTP → Queue → Workflow → SMTP pipeline, including the two-layer retry
  design and the primitive-return workaround.
- The error classifier and friendly-message mapping.
- AES-256-GCM helpers and the encrypted-field pattern.
- The module structure (controller/service/repository/DTO/barrel).
- The Miniflare D1 test helper and the Vitest setup.
- The single-Worker UI+API deployment model.

### 12.2 What you must change before real use

1. **D1 lifecycle** — remove the wipe/recreate steps from
   `.github/workflows/deploy.yml`; use forward migrations only.
2. **CORS** — replace `origin: (origin) => origin` with an allowlist; add
   `x-api-key` to `allowHeaders`.
3. **SMTP config responses** — never return `smtpPassword`; add a write-only
   field pattern.
4. **Error responses** — return generic messages for 500s; keep details in
   logs.
5. **Secrets/logging** — redact recipient addresses and query strings; add
   request IDs.
6. **Key management** — add key versioning/rotation before storing real data.
7. **Rate limiting** — add edge/API-level limits (KV, Durable Objects or
   Workers Rate Limiting) in addition to Better Auth's per-key limit.
8. **Pagination** — fix the cursor encoding, or switch to an opaque base64
   cursor.
9. **Idempotency** — add a dedup key/provider idempotency if duplicate sends
   are unacceptable.
10. **Registration** — replace the "first user only" rule with a real
    onboarding/invite flow if multi-tenant.
11. **Deliverability** — configure SPF/DKIM/DMARC at the provider/domain level;
    the code cannot do this for you.
12. **Port/TLS** — make `secure` configurable if you need 587/STARTTLS.
13. **Missing config classification** — treat `AppError(404)`/config errors as
    permanent instead of retrying five cycles.
14. **Frontend** — fix the fabricated chart, `Layout.astro` title, duplicated
    escaping, and add tests/lint.
15. **Dependencies** — review `pnpm-lock.yaml`, pin Wrangler, and keep
    `compatibility_date` current.

### 12.3 Fork checklist

- [ ] Rename Worker, D1, queue, DLQ and workflow in `wrangler.jsonc`
      (production **and** preview).
- [ ] Replace the production `database_id`; remove the CI rewrite.
- [ ] Set `BETTER_AUTH_URL` / `FRONTEND_URL` to your domain.
- [ ] Decide whether the Worker still serves the frontend (`assets`) or split
      it out.
- [ ] Regenerate `worker-configuration.d.ts` (`pnpm cf-typegen`) and stop
      tracking stale generated types if possible.
- [ ] Re-run `pnpm lint`, `pnpm test:run`, `pnpm --filter ./frontend build`.
- [ ] Apply the security fixes in §12.2 before exposing to users.
- [ ] Update `README.md`, `AGENTS.md` and these docs to match your fork.

---

## 13. Agent checklist

When working in this repo, an automated agent should:

1. **Read before writing** — `backend/src/index.ts`, the relevant module, and
   the closest test.
2. **Respect the architecture** — controller/service/repository/DTO; no
   repository in routes; no `c.env` in controllers.
3. **Keep the send pipeline invariants** — one SMTP attempt, primitive step
   returns, terminal history rows, instance id format, `FINAL_ATTEMPT` sync.
4. **Validate with Zod** and keep `.strict()`.
5. **Add or update tests** for every behavior change.
6. **Run** `cd backend && pnpm lint && pnpm test:run` before finishing. Do not
   claim `tsc` passes unless `pnpm exec tsc --noEmit` is clean.
7. **Build the frontend** (`pnpm --filter ./frontend build`) if you touched it.
8. **Do not commit** unless explicitly asked; never commit `.dev.vars`,
   `.env`, `.wrangler`, secrets or generated artifacts.
9. **Do not “fix” the D1 wipe, CORS or password exposure silently** — those are
   deliberate POC trade-offs; call them out and ask before changing behavior.
10. **Document drift** — if you change routes, bindings, env vars or the retry
    ladder, update `ARCHITECTURE.md`/`DEVELOPER_GUIDE.md` (both languages) and
    `AGENTS.md`.

---

## 14. Where things live

| Need | File |
|---|---|
| Worker entrypoint / DI / middleware order | `backend/src/index.ts` |
| Typed config | `backend/src/config/config.ts` |
| Better Auth | `backend/src/lib/auth.ts` |
| API-key middleware | `backend/src/middleware/api-key.middleware.ts` |
| Send controller + DTO | `backend/src/send-email/send-email.controller.ts`, `send-email.dto.ts` |
| Queue message contract | `backend/src/send-email/send-email.types.ts` |
| SMTP transport | `backend/src/transports/smtp-email.transport.ts` |
| Transport resolution | `backend/src/send-email/transport-resolver.ts` |
| Error classifier | `backend/src/send-email/error-classifier.ts` |
| Queue consumer | `backend/src/queue/send-email.consumer.ts` |
| Workflow + retry decision | `backend/src/workflows/send-email.workflow.ts` |
| Template renderer | `backend/src/templates/template-renderer.ts` |
| Schema | `backend/src/db/schema.ts` |
| Migrations | `backend/drizzle/` |
| Crypto | `backend/src/core/crypto.ts` |
| Sanitizer | `backend/src/core/html-sanitizer.ts` |
| Logs/pagination | `backend/src/email-logs/email-logs.repository.ts` |
| Dashboard SQL | `backend/src/dashboard/dashboard.repository.ts` |
| Test D1 helper | `backend/test/helpers/d1-setup.ts` |
| Workflow test stub | `backend/test/unit/workflows/send-email.workflow.test.ts` |
| Worker config | `backend/wrangler.jsonc` |
| CI/CD | `.github/workflows/ci.yml`, `deploy.yml` |
| Frontend API helper | `frontend/src/lib/api.ts` |
| Frontend dev proxy | `frontend/astro.config.mjs` |
| Existing docs | `README.md`, `AGENTS.md`, `docs/ARCHITECTURE.md` |

---

*See `ARCHITECTURE.md` for the full system description and
`ARCHITECTURE.fr.md` / `DEVELOPER_GUIDE.fr.md` for the French versions.*
