# Self-host MakiSend on a VPS

Run MakiSend on any small Linux server with Docker: one image, one container, HTTPS through Caddy. No Cloudflare account is needed.

> **Read this first.** The image runs the same Worker as production, inside `workerd`, through `wrangler dev --local`. D1, Queues and Workflows are *emulated* by Miniflare, so this is a **single-instance** set-up meant for personal and small-team use. It is not the scalable Cloudflare deployment (see the README, "Deploy to Cloudflare"). If you need scale or high availability, deploy to Cloudflare.

## What you get

| | VPS image | Cloudflare deployment |
|---|---|---|
| API + dashboard | one container, port 8787 | one Worker |
| Database | SQLite file in the `/data` volume (D1 emulated) | Cloudflare D1 |
| Queue + retry workflow | emulated, same code | Cloudflare Queues + Workflows |
| Daily SMTP check, hourly key rotation | run by a small scheduler inside the container | Cloudflare cron triggers |
| Cloudflare Email Service config (`smtp.mx.cloudflare.net`) | **not available** (needs the Worker binding) | available |
| Scaling / failover | none: one container | managed |

There is no choice of database: the code is written for D1 (SQLite). Do not expect Postgres or MySQL.

## Requirements

- A VPS with Docker and the Compose plugin (1 vCPU and 1 GB of RAM is enough to start; the first start needs a few seconds).
- A domain name with an `A` record pointing to the VPS, ports 80 and 443 open.
- **Outbound SMTP on 465 or 587.** MakiSend sends through *your* SMTP provider (Zoho, Brevo, Postmark, SES...). Port 25 is refused by design, and some VPS providers block outbound SMTP: check yours.
- Deliverability still depends on your SMTP provider and your domain (SPF, DKIM, DMARC), not on the VPS.

## Install

```bash
mkdir makisend && cd makisend
curl -fsSLO https://raw.githubusercontent.com/lixalistudio-oss/makisend/main/docker/compose.vps.yml
curl -fsSL https://raw.githubusercontent.com/lixalistudio-oss/makisend/main/docker/vps.env.example -o .env
```

Edit `.env`: set `DOMAIN`, `BETTER_AUTH_URL`, `FRONTEND_URL`, and generate the two secrets.

```bash
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"        # paste into .env
echo "BETTER_AUTH_SECRET=$(openssl rand -base64 32)" # paste into .env
docker compose -f compose.vps.yml up -d
```

Open `https://your-domain`: the first visit creates the administrator account (the only account the instance will ever accept). Then add your SMTP configuration, create an API key and send:

```bash
curl -X POST https://your-domain/send-email \
  -H "x-api-key: $MAKISEND_KEY" -H "content-type: application/json" \
  -d '{"to":"you@example.com","subject":"Hello","text":"It works from my VPS."}'
```

Keep a copy of `ENCRYPTION_KEY` outside the server: recipients, bodies and SMTP credentials are encrypted with it, and a lost key makes them unreadable. `BETTER_AUTH_SECRET` also protects two-factor secrets.

## Update

Releases publish a new image (`latest`, `X.Y.Z`, `X.Y`). To update:

```bash
docker compose -f compose.vps.yml pull
docker compose -f compose.vps.yml up -d
```

Database migrations are applied when the container starts, and are a no-op when already applied. To stay on a version, set `MAKISEND_VERSION=0.3.0` in `.env`. The dashboard's new-release banner works as usual; ignore its *Update* button, which targets Cloudflare copies.

## Back up and restore

Everything lives in the `makisend-data` volume (plus your two secrets).

```bash
docker compose -f compose.vps.yml stop makisend
docker run --rm -v makisend_makisend-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/makisend-data.tgz -C /data .
docker compose -f compose.vps.yml start makisend
```

Restore by extracting the archive into an empty volume with the same command in reverse, with the same `ENCRYPTION_KEY` and `BETTER_AUTH_SECRET`. (The volume is named `<project>_makisend-data`; list it with `docker volume ls`.)

## Run it without Caddy

```bash
docker run -d --name makisend --restart unless-stopped -p 127.0.0.1:8787:8787 \
  -v makisend-data:/data \
  -e ENCRYPTION_KEY=... -e BETTER_AUTH_SECRET=... \
  -e BETTER_AUTH_URL=https://your-domain -e FRONTEND_URL=https://your-domain \
  ghcr.io/lixalistudio-oss/makisend:latest
```

Put your own reverse proxy (nginx, Traefik...) in front for HTTPS. Do not expose port 8787 to the internet in plain HTTP.

## Known limits

- One container: no failover, and a restart briefly interrupts requests.
- It is a development server under the hood (`wrangler dev`); Cloudflare documents it for local use. It is tested in CI (`pnpm test:e2e:docker`: a real mail through Mailpit, cron, restart with data kept) but not load-tested.
- The image is public on `ghcr.io/lixalistudio-oss/makisend`, multi-arch (`amd64`, `arm64`).

## Troubleshooting

- `docker compose -f compose.vps.yml logs -f makisend` shows the Worker, the scheduler (`[scheduler]` lines) and each send.
- The container exits at once: `ENCRYPTION_KEY` or `BETTER_AUTH_SECRET` is missing.
- Sign-in fails behind a proxy: `BETTER_AUTH_URL` and `FRONTEND_URL` must equal the public `https://` URL.
- The SMTP check fails with a connection error: your provider's host and port (465 TLS or 587 STARTTLS), and that the VPS allows outbound traffic on it.
