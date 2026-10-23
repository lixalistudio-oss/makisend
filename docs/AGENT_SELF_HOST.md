# Agent prompt: self-host MakiSend on your own Cloudflare account

Paste everything below the line into a coding agent (Claude Code, Codex, OpenCode…) opened at the root of a MakiSend clone. The agent works from your machine, on **your** Cloudflare account, with the [`cf` CLI](https://developers.cloudflare.com/cli/).

---

You are taking over a clone of **MakiSend**, a self-hosted transactional email service (Hono on Cloudflare Workers, D1, Queues, Workflows, nodemailer over SMTP). Your job: understand the repo, deploy it to the user's own Cloudflare account, and leave it secure. Report to the user in their language. Explain each step before running it, and stop to ask whenever a choice belongs to them.

## 1. Learn the repo

Read `AGENTS.md` (architecture, conventions, security model, key rotation), then `README.md` (Configuration, Deployment, Security) and `backend/wrangler.jsonc`. Done when you can state: which Cloudflare resources the Worker binds, which secrets it reads, and how the dashboard and the API share one origin.

Verify the code before touching the account:

```bash
pnpm install --frozen-lockfile
cd backend && pnpm lint && pnpm exec tsc --noEmit && pnpm test:run && cd ..
pnpm --filter frontend build    # the Worker serves frontend/dist
```

All green, or stop and report.

## 2. Connect to the user's account

```bash
cf auth whoami || cf auth login     # the user completes the browser login themselves
cf accounts list                    # confirm WHICH account with the user before creating anything
```

Use `cf --help` or `cf cli search "<what you want>"` to find a command; never guess flags.

## 3. Create the resources

Pick names with the user (defaults: Worker `makisend`, D1 `makisend-db`, queues `makisend-send-email` and `makisend-send-email-dlq`, Workflow `makisend-send-email`).

```bash
cf d1 create --name makisend-db --primary-location-hint weur    # ask for the region; keep the returned uuid
cf queues create --queue-name makisend-send-email
cf queues create --queue-name makisend-send-email-dlq
```

Then edit `backend/wrangler.jsonc`, top-level (production) section only:

- `name` → the Worker name;
- `d1_databases[0].database_id` → the uuid above (the one in the file belongs to the upstream instance), `database_name` → the D1 name;
- queue and workflow names, if the user changed them, in `producers`, `consumers` and `workflows`.

Leave binding names (`makisend_db`, `SEND_EMAIL_QUEUE`, `SEND_EMAIL_DLQ`, `SEND_EMAIL_WORKFLOW`, `EMAIL`, `ASSETS`) as they are: the code depends on them.

## 4. Apply the schema

```bash
cd backend
cf d1 migrations apply <d1-uuid> --dir drizzle
```

Drizzle Kit owns the schema: migrations only move forward. Never drop, delete or recreate this database once it holds data.

## 5. Deploy the Worker

The repo is a Wrangler project and uses **Cloudflare Workflows**, which `cf`'s own config (`cf migrate`) does not support yet. Upload the Worker with the Wrangler version pinned in `backend/package.json`, keep `cf` for everything else:

```bash
cd backend && pnpm exec wrangler deploy --minify
```

Get the public URL: `cf workers get <worker>` (`*.workers.dev`), or the custom domain if the user set one.

## 6. Set the secrets

Generate locally, pipe straight into the Worker, never print or log a value, never commit one:

| Secret | Value |
|---|---|
| `ENCRYPTION_KEY` | `openssl rand -hex 32` (64 hex) |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 48` |
| `BETTER_AUTH_URL` | the Worker's public URL |
| `FRONTEND_URL` | the same URL (dashboard and API share one origin) |
| `SEND_RATE_LIMIT` | optional, recommended: e.g. `100/min` (see step 8) |

```bash
cf workers secrets update ENCRYPTION_KEY --worker <worker> --type secret_text --text "$(openssl rand -hex 32)"
cf workers secrets list --worker <worker>    # names only
```

Tell the user to store `ENCRYPTION_KEY` and `BETTER_AUTH_SECRET` in their password manager now: losing `ENCRYPTION_KEY` makes every stored SMTP credential, recipient and body unreadable; changing `BETTER_AUTH_SECRET` signs everyone out and breaks two-factor set-ups.

## 7. Verify, then hand over

- `curl -sI <url>/` answers the dashboard; `curl -s <url>/openapi.json` answers JSON; `curl -s <url>/api/setup-status` answers `{"needsSetup":true}`.
- The **user** opens `<url>/setup` and creates the administrator (the first account is the only one). Do it right after the deploy: until then, anyone who reaches the URL can claim the instance.
- After that, a second sign-up must answer 403.

## 8. Security practices to apply and explain

Apply these, tell the user what each protects, and ask before anything that changes their account beyond this Worker:

1. **Claim the instance at once** (step 7) and turn on **two-factor authentication** in Settings.
2. **`SEND_RATE_LIMIT`** whenever the API is reachable from the internet: without it, a leaked API key can send without limit from the user's SMTP account (suspension, blacklisted domain). Over the quota the API answers `429` + `Retry-After`.
3. **One API key per integration**, linked to the SMTP configuration it needs; revoke a key the moment it leaks (repo, log, browser bundle). Keys belong on servers, never in front-end code.
4. **Secrets live only in Worker secrets**: none in `wrangler.jsonc`, `.env` files that get committed, CI logs or chat.
5. **Key rotation, never replacement**: to change `ENCRYPTION_KEY`, follow `AGENTS.md` → "Key rotation" (`ENCRYPTION_KEY_PREVIOUS`, hourly cron, wait for `remaining: 0`).
6. **Sender domain**: SPF, DKIM and DMARC on the domain used as sender; MakiSend does not set them.
7. **SMTP credentials**: a dedicated SMTP user or app password for MakiSend, not a personal mailbox password.
8. **Optional, if the dashboard should not be public**: put Cloudflare Access in front of the dashboard paths, and leave `/send-email`, `/openapi.json` and `/docs` reachable for API clients. Ask first: it changes how the user signs in.
9. **Updates**: pull upstream, rerun step 1, apply new migrations (step 4), redeploy (step 5). Watch `pnpm audit --prod`.

## Done when

The Worker answers at its URL, migrations are applied, all required secrets are set (`cf workers secrets list`), the user has created the administrator, and you have given them a short summary: URL, resource names, which secrets they must keep safe, and which of the practices above are applied or still open.
