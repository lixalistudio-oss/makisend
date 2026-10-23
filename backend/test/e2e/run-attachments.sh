#!/usr/bin/env bash
# Attachments end to end against MakiSend under `wrangler dev` (local D1, Queues, Workflows and the
# simulated `send_email` binding). Never deploys anything; every secret is generated here and dropped.
# Usage: test/e2e/run-attachments.sh      → writes test/e2e/reports/attachments.json
set -euo pipefail
cd "$(dirname "$0")/../.."

PORT="${PORT:-8788}"
STATE="${TMPDIR:-/tmp}/makisend-attachments-e2e-state"
LOG="${TMPDIR:-/tmp}/makisend-attachments-e2e-wrangler.log"
stop_dev() { pkill -f "makisend-attachments-e2e-state" 2>/dev/null || true; }
stop_dev
sleep 1
rm -rf "$STATE" "$LOG"

DEV_VARS="$(mktemp)"
cat > "$DEV_VARS" <<EOF
ENCRYPTION_KEY=$(openssl rand -hex 32)
BETTER_AUTH_SECRET=$(openssl rand -hex 32)
BETTER_AUTH_URL=http://localhost:${PORT}
FRONTEND_URL=http://localhost:${PORT}
RATE_LIMIT=off
EOF

# The Worker serves the dashboard from frontend/dist: build it if it is not there.
[[ -d ../frontend/dist ]] || pnpm --filter frontend build >/dev/null

pnpm exec wrangler d1 migrations apply makisend_db --local --persist-to "$STATE" >/dev/null

pnpm exec wrangler dev --local --port "$PORT" --persist-to "$STATE" --env-file "$DEV_VARS" --show-interactive-dev-session=false >"$LOG" 2>&1 &
WRANGLER=$!
trap 'kill $WRANGLER 2>/dev/null || true; stop_dev; rm -f "$DEV_VARS"' EXIT

for _ in $(seq 1 60); do
  curl -fs "http://127.0.0.1:${PORT}/openapi.json" >/dev/null 2>&1 && break
  sleep 1
done

BASE_URL="http://127.0.0.1:${PORT}" ORIGIN="http://localhost:${PORT}" WRANGLER_LOG="$LOG" \
  pnpm exec tsx test/e2e/attachments.ts
