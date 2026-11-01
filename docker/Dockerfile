# Self-hosting image, published to ghcr.io/lixalistudio-oss/makisend by
# .github/workflows/docker-publish.yml. It runs the same Worker as production inside workerd
# (`wrangler dev --local`), with D1, Queues and Workflows emulated by Miniflare and persisted in
# /data. The dev image used by docker-compose is the root Dockerfile.
#
# Slim by construction: the Worker and the dashboard are built once here, and the final image only
# holds the bundle, the migrations, the static assets and wrangler (workerd) itself: no sources, no
# pnpm, no dev dependencies, no test tooling.

# 1) Build: install everything, bundle the Worker, build the dashboard.
FROM node:22-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@11 --activate
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc package.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter frontend build

WORKDIR /app/backend
# `--env ""` targets the top-level (production) config; the bundle lands in /out/worker.
RUN pnpm exec wrangler deploy --dry-run --env "" --minify --outdir /out/worker \
 && rm -f /out/worker/*.map /out/worker/README.md \
 && node ../docker/runtime-config.cjs /app/backend /out/wrangler.json \
 && cp -r drizzle /out/drizzle \
 && cp -r ../frontend/dist /out/assets \
 && node -p "require('wrangler/package.json').version" > /out/wrangler-version

# 2) Runtime dependency: wrangler alone (it brings workerd and Miniflare), at the version of the lockfile.
FROM node:22-bookworm-slim AS runtime-deps
WORKDIR /opt/runtime
COPY --from=build /out/wrangler-version ./
RUN npm install --omit=dev --no-audit --no-fund --no-package-lock "wrangler@$(cat wrangler-version)" \
 && npm cache clean --force \
 && find node_modules -name "*.map" -delete \
 && rm -rf node_modules/@img node_modules/sharp node_modules/fsevents

# 3) Final image.
FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=runtime-deps /opt/runtime/node_modules /opt/runtime/node_modules
COPY --from=build /out/wrangler.json ./wrangler.json
COPY --from=build /out/drizzle ./drizzle
COPY --from=build /out/assets ./assets
COPY --from=build /out/worker ./worker
COPY docker/entrypoint.sh docker/scheduler.mjs ./docker/
RUN mkdir -p /data && chown -R node:node /data /app

USER node

# HOME is writable for wrangler's logs and cache; -e SECRET=... reaches the Worker as a binding.
ENV PATH=/opt/runtime/node_modules/.bin:$PATH \
    HOME=/tmp \
    CI=1 \
    WRANGLER_SEND_METRICS=false \
    CLOUDFLARE_INCLUDE_PROCESS_ENV=true \
    UPDATE_CHECK=on

# D1 database, queues and workflow state live here: mount a volume.
VOLUME /data
EXPOSE 8787

ENTRYPOINT ["sh", "/app/docker/entrypoint.sh"]
