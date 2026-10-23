# MakiSend Documentation

Documentation for the MakiSend POC (Cloudflare Workers transactional email API).

| Document | Contents |
|---|---|
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | End-to-end architecture: system context, request lifecycle, auth planes, data model and encryption, module catalogue, send/template flows, retry state machine, security model, observability, frontend, deployment, design decisions, known limitations, file map |
| [`DEVELOPER_GUIDE.md`](./DEVELOPER_GUIDE.md) | Setup and `.dev.vars`, commands, Docker, testing with Miniflare D1, database workflow, recipes for new modules/routes/workflow steps/templates/frontend pages, debugging table, deployment and CI warnings, reuse/fork guide, agent checklist |

Related docs:

- [`../README.md`](../README.md) — project overview, architecture diagrams, API endpoints
- [`../AGENTS.md`](../AGENTS.md) — condensed architecture and conventions for coding agents
- [`../makisend-design.excalidraw`](../makisend-design.excalidraw) — design board (POC notes and the current technical architecture)

## Reading order

1. `ARCHITECTURE` — understand the system and its trade-offs.
2. `DEVELOPER_GUIDE` — run it, change it, test it.
3. `AGENTS.md` — quick conventions when editing code.

## Checks

Run from `backend/`:

- Tests: `pnpm test:run`
- Lint: `pnpm lint`
- Typecheck: `pnpm exec tsc --noEmit`

CI runs lint, typecheck, tests and the frontend build on pull requests and pushes to `main` and `dev`.
