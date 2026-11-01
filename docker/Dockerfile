# Self-hosting image, published to ghcr.io/lixalistudio-oss/makisend by
# .github/workflows/docker-publish.yml. It runs the same Worker as production inside
# workerd (`wrangler dev --local`), with D1, Queues and Workflows emulated by Miniflare and
# persisted in /data. The dev image used by docker-compose is the root Dockerfile.
FROM node:22-bookworm-slim

RUN corepack enable && corepack prepare pnpm@11 --activate

WORKDIR /app

# Dependency layer first, cached across source edits.
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc package.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN pnpm install --frozen-lockfile

COPY . .

# The Worker serves frontend/dist as static assets.
RUN pnpm --filter frontend build

COPY docker/entrypoint.sh /usr/local/bin/makisend-entrypoint
RUN chmod +x /usr/local/bin/makisend-entrypoint \
 && mkdir -p /data && chown -R node:node /app /data

USER node
WORKDIR /app/backend

ENV CI=1 \
    WRANGLER_SEND_METRICS=false \
    CLOUDFLARE_INCLUDE_PROCESS_ENV=true \
    UPDATE_CHECK=on

# D1 database, queues and workflow state live here: mount a volume.
VOLUME /data
EXPOSE 8787

ENTRYPOINT ["makisend-entrypoint"]
