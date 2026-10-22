# MakiSend Documentation / Documentation MakiSend

Bilingual documentation for the MakiSend POC (Cloudflare Workers transactional
email API).

Documentation bilingue du POC MakiSend (API d'emails transactionnels sur
Cloudflare Workers).

---

## English

| Document | Contents |
|---|---|
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | End-to-end architecture: system context, request lifecycle, auth planes, data model and encryption, module catalogue, send/template flows, retry state machine, security model, observability, frontend, deployment, design decisions, known limitations, file map |
| [`DEVELOPER_GUIDE.md`](./DEVELOPER_GUIDE.md) | Setup and `.dev.vars`, commands, Docker, testing with Miniflare D1, database workflow, recipes for new modules/routes/workflow steps/templates/frontend pages, debugging table, deployment and CI warnings, reuse/fork guide, agent checklist |

Related existing docs:

- [`../README.md`](../README.md) — project overview (French; some sections
  have drifted, see the note below)
- [`../AGENTS.md`](../AGENTS.md) — condensed architecture and conventions for
  coding agents
- [`../FICHE_SUJET.md`](../FICHE_SUJET.md) — broader target-product vision
  (not implemented)
- [`../rapport.md`](../rapport.md) — historical report (Inngest / Cloudflare
  Pages era)

> **Documentation drift:** `README.md` has been refreshed for API keys, SMTP
> port/TLS, rate limiting, and the API reference, but some narrative sections
> may still lag behind `AGENTS.md`. Run commands from `backend/`, and remember
> that Wrangler reads `backend/.dev.vars`.

## Français

| Document | Contenu |
|---|---|
| [`ARCHITECTURE.fr.md`](./ARCHITECTURE.fr.md) | Architecture de bout en bout : contexte système, cycle de vie d'une requête, plans d'authentification, modèle de données et chiffrement, catalogue des modules, flux d'envoi/template, machine à états des retries, modèle de sécurité, observabilité, frontend, déploiement, décisions de conception, limites connues, carte des fichiers |
| [`DEVELOPER_GUIDE.fr.md`](./DEVELOPER_GUIDE.fr.md) | Installation et `.dev.vars`, commandes, Docker, tests avec D1 Miniflare, workflow base de données, recettes pour nouveaux modules/routes/étapes de workflow/templates/pages frontend, tableau de débogage, avertissements déploiement et CI, guide de réutilisation/fork, checklist agent |

Docs existantes associées :

- [`../README.md`](../README.md) — vue d'ensemble du projet (français ;
  certaines sections ont dérivé, voir la note ci-dessous)
- [`../AGENTS.md`](../AGENTS.md) — architecture et conventions condensées pour
  les agents de code
- [`../FICHE_SUJET.md`](../FICHE_SUJET.md) — vision produit cible plus large
  (non implémentée)
- [`../rapport.md`](../rapport.md) — rapport historique (ère Inngest /
  Cloudflare Pages)

> **Dérive documentaire :** `README.md` a été actualisé pour les clés API, le
> port/TLS SMTP, le rate limiting et la référence API, mais certaines sections
> narratives peuvent encore retarder sur `AGENTS.md`. Lancez les commandes
> depuis `backend/` et rappelez-vous que Wrangler lit `backend/.dev.vars`.

---

## Reading order / Ordre de lecture

1. `ARCHITECTURE` — understand the system and its trade-offs.
2. `DEVELOPER_GUIDE` — run it, change it, test it.
3. `AGENTS.md` — quick conventions when editing code.

1. `ARCHITECTURE.fr` — comprendre le système et ses compromis.
2. `DEVELOPER_GUIDE.fr` — le lancer, le modifier, le tester.
3. `AGENTS.md` — conventions rapides pour éditer le code.

---

## Snapshot / Instantané

- Branch: `feat/new-features-patch-from-notifier`
- API reference: `GET /docs` (Scalar) and `GET /openapi.json` (OpenAPI 3.1)
- Tests: 26 files / 288 tests pass (`cd backend && pnpm test:run`)
- Lint: passes (`cd backend && pnpm lint`)
- Typecheck: passes (`cd backend && pnpm exec tsc --noEmit`)
- CI: lint, typecheck, tests, and frontend build on pushes/PRs to `main` and `dev`
