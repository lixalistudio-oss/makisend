# Local development image — not intended for production (deploys go via `pnpm deploy`).
FROM node:22-bookworm-slim

# pnpm via corepack, pinned to the same major as the host tooling.
RUN corepack enable && corepack prepare pnpm@11 --activate

WORKDIR /workspace

# 1) Dependency layer first — cached across source edits.
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc package.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN pnpm install --frozen-lockfile

# 2) Source. node_modules, .wrangler and secret files are excluded by .dockerignore;
#    compose bind-mounts the repo over /workspace at run time anyway.
COPY . .

WORKDIR /workspace/backend

CMD ["pnpm", "dev"]
