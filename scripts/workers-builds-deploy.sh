#!/usr/bin/env bash
# Deploy command of Workers Builds, used by the "Deploy to Cloudflare" button (README) and by
# every push to a copy of this repository connected to Workers Builds. Cloudflare pre-fills
# the deploy step with `pnpm run deploy` because this script is the root `deploy`.
#
# It refuses to run anywhere else: our own instance deploys through GitHub Actions only
# (.github/workflows/deploy.yml, with backend/wrangler.jsonc), never from a laptop.
set -euo pipefail

if [ "${WORKERS_CI:-}" != "1" ]; then
  echo "This script only runs inside Cloudflare Workers Builds (WORKERS_CI=1)." >&2
  echo "Deployments of this repository go through GitHub Actions; see README, \"Deployment\"." >&2
  exit 1
fi

# Uses the binding name, not the database name: the button lets the user rename the
# database, and the binding stays `makisend_db`. Applying migrations twice is a no-op.
pnpm exec wrangler d1 migrations apply makisend_db --remote

# Queue producers must point at existing queues. The button provisions them; on a copy
# deployed through Workers Builds without the button they may be missing. Already
# existing is fine.
for queue in makisend-send-email makisend-send-email-dlq; do
  pnpm exec wrangler queues create "$queue" >/dev/null 2>&1 || true
done

pnpm exec wrangler deploy --minify
