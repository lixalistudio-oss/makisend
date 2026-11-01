#!/usr/bin/env sh
# Applies the D1 migrations (a no-op when already applied), starts the cron scheduler, then the Worker.
set -eu

: "${ENCRYPTION_KEY:?ENCRYPTION_KEY is required (openssl rand -hex 32)}"
: "${BETTER_AUTH_SECRET:?BETTER_AUTH_SECRET is required (openssl rand -base64 32)}"

cd /app/backend
pnpm exec wrangler d1 migrations apply makisend_db --local --persist-to /data

node /app/docker/scheduler.mjs &

exec pnpm exec wrangler dev --local --test-scheduled --ip 0.0.0.0 --port 8787 --persist-to /data
