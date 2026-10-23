# MakiSend

MakiSend est un Proof of Concept (POC) pour une API serverless d’envoi d’emails transactionnels, déployée sur **Cloudflare Workers**.

Ce POC vise à valider trois hypothèses :

1. Peut-on déployer un backend serverless utilisant **nodemailer** et SMTP brut sur Cloudflare Workers ?
2. Peut-il fonctionner à l’échelle ?
3. Les emails peuvent-ils atterrir dans la boîte de réception plutôt que dans les spams ?

Pour le contexte technique complet — architecture, conventions, flux de développement et limitations — voir [`AGENTS.md`](./AGENTS.md).

---

## Stack technique

- **Runtime** : Cloudflare Workers (`workerd`)
- **Framework web** : [Hono](https://hono.dev/)
- **Validation** : [Zod](https://zod.dev/) + `@hono/zod-validator`
- **ORM / Base de données** : [Drizzle ORM](https://orm.drizzle.team/) + Cloudflare D1 (SQLite)
- **Envoi d’emails** : [nodemailer](https://nodemailer.com/) via SMTP brut
- **Architecture** : Repository / Service / Controller (inspirée de NestJS)
- **Logging** : [Pino](https://getpino.io/), configuré pour l’edge sans transport Node.js
- **Tests** : [Vitest](https://vitest.dev/)
- **Documentation API** : OpenAPI 3.1 + [Scalar](https://scalar.com/)
- **Lint** : ESLint + TypeScript ESLint
- **Chiffrement** : Web Crypto API (AES-256-GCM)
- **Nettoyage HTML** : `sanitize-html`

---

## Prérequis

- [Node.js](https://nodejs.org/) 22+
- [pnpm](https://pnpm.io/)
- Un compte Cloudflare avec accès à Workers et D1
- Des identifiants SMTP d’un fournisseur d’emails (SendGrid, Resend, Gmail, etc.)

---

## Installation

```bash
pnpm install
```

Copie le fichier d’exemple des variables d’environnement :

```bash
cp .env.example .env
```

Puis remplis les valeurs dans `.env` (voir la section [Configuration](#configuration)).

---

## Configuration

Les variables suivantes sont définies dans `.env` et mappées dans `src/index.ts` via le type `Bindings` :

| Variable | Description |
|----------|-------------|
| `AES_256_KEY` | Clé AES-256 au format hexadécimal 64 caractères. Générer avec : `openssl rand -hex 32` |
| `BETTER_AUTH_SECRET` | Secret de signature Better Auth |
| `BETTER_AUTH_URL` | URL de base du Worker (ex. `http://localhost:8787`) |
| `FRONTEND_URL` | Origine frontend autorisée (CORS / redirections) |

Plus des variables d'environnement :

- **Identifiants SMTP** (`SMTP_USER`, `SMTP_PASSWORD`, `SENDER_EMAIL`, `HOST`) : stockés par utilisateur, chiffrés dans D1, gérés via le module `smtp-config`. Le port et le mode TLS (`tls` ou `starttls`) sont propres à chaque configuration ; le port 25 est refusé.
- **`API_KEY`** : les clés API sont par utilisateur (module `api-keys`, Better Auth), envoyées dans `x-api-key` ou `Authorization: Bearer`.

Ces variables sont transformées en un objet `Config` typé par `createConfig()` et injectées dans les services.

---

## Commandes disponibles

| Commande | Description |
|----------|-------------|
| `pnpm dev` | Démarre le serveur de développement local |
| `pnpm deploy` | Déploie sur Cloudflare Workers |
| `pnpm cf-typegen` | Génère les types TypeScript à partir de la configuration Wrangler |
| `pnpm test` | Lance les tests en mode watch |
| `pnpm test:run` | Lance les tests une fois |
| `pnpm test:ui` | Lance les tests avec l’interface Vitest |
| `pnpm test:coverage` | Lance les tests avec couverture |
| `pnpm lint` | Vérifie le lint |
| `pnpm lint:fix` | Corrige automatiquement les problèmes de lint |

---

## Développement avec Docker

Pour développer sans rien installer localement (hormis Docker), le projet fournit une stack de développement locale :

```bash
docker compose build   # ou: pnpm docker:build
docker compose up -d   # ou: pnpm docker:up
```

| URL | Service | Contenu |
|-----|---------|---------|
| `http://localhost:8787` | `backend` | Worker via `wrangler dev --local` (D1, Queues et Workflows simulés localement par Miniflare) |
| `http://localhost:4321` | `frontend` | Serveur de dev Astro, proxy Vite vers `http://backend:8787` |

- Le hot reload fonctionne sur les deux services (le dépôt est monté en volume).
- L'état local D1/Queues/Workflows est celui de `backend/.wrangler` (monté depuis l'hôte, persiste après `docker compose down`).
- `.env` et `.dev.vars` sont lus par Wrangler depuis le répertoire de travail monté — aucun secret n'est copié dans l'image (exclus via `.dockerignore`).
- **Ne pas lancer `pnpm dev` sur l'hôte en même temps** (conflit sur le port 8787).

Commandes hors-ligne (sans rien installer sur l'hôte) :

```bash
pnpm docker:test       # docker compose run --rm backend pnpm test:run
pnpm docker:lint       # docker compose run --rm backend pnpm lint
pnpm docker:migrate    # applique les migrations D1 en local
pnpm docker:down       # arrête la stack
```

Le déploiement sur Cloudflare (`pnpm deploy`) reste inchangé et se fait depuis l'hôte ou depuis le conteneur (avec `CLOUDFLARE_API_TOKEN`).

Un devcontainer (` .devcontainer/`) réutilise la même compose pour ouvrir le projet dans VS Code / Cursor.

---

## Documentation API

Une référence interactive est servie par le Worker :

- **Guide intégré au dashboard** : `/dashboard/api-docs` (authentification, cycle de livraison, SMTP, templates, endpoints, erreurs)
- **Scalar** : `http://localhost:8787/docs` (ou l'URL du Worker déployé)
- **OpenAPI 3.1** : `http://localhost:8787/openapi.json`

Les schémas de requête sont générés depuis les DTO Zod afin de rester alignés sur la validation réelle.

## Endpoints

| Méthode | Route | Authentification | Description |
|---------|-------|------------------|-------------|
| `POST` | `/send-email` | Clé API (`x-api-key` ou Bearer) | Met un email en file ; supporte `Idempotency-Key`, contenu inline ou `templateId` |
| `GET/POST` | `/smtp-config` | Session | Liste / crée une configuration SMTP |
| `GET/PUT/DELETE` | `/smtp-config/{id}` | Session | Consulte / modifie / supprime une configuration |
| `POST` | `/smtp-config/check` | Session | Teste des identifiants non enregistrés |
| `POST` | `/smtp-config/{id}/check` | Session | Teste une configuration enregistrée |
| `POST` | `/smtp-config/{id}/test-send` | Session | Envoie un email de test (non journalisé) |
| `GET/POST` | `/api-keys` | Session | Liste / crée une clé API liée à une configuration |
| `DELETE` | `/api-keys/{id}` | Session | Révoque une clé API |
| `GET` | `/email-logs` | Session | Liste paginée des logs (filtres `status`, `smtpConfigId`, `to`) |
| `GET` | `/email-logs/{id}` | Session | Détail d'un log et de son historique |
| `GET` | `/dashboard/stats`, `/dashboard/by-config`, `/dashboard/recent`, `/dashboard/errors` | Session | Métriques de livraison |
| `GET/POST` | `/templates` | Session | Liste / crée un template |
| `GET/PUT/DELETE` | `/templates/{id}` | Session | Consulte / modifie / supprime un template |
| `POST` | `/templates/{id}/preview` | Session | Rend le template avec des variables d’exemple |

Les routes `/api/auth/*` sont fournies par [Better Auth](https://www.better-auth.com/) (inscription, connexion, session, déconnexion).

### `POST /send-email`

Envoie un email transactionnel au destinataire spécifié.

#### Headers

| Header | Valeur |
|--------|--------|
| `Content-Type` | `application/json` |
| `x-api-key` ou `Authorization` | `Bearer <API_KEY>` *(clé API par utilisateur, créée via Better Auth)* |

#### Body

```json
{
  "to": "destinataire@example.com",
  "subject": "Objet de l’email",
  "text": "Version texte brute du message (min. 10 caractères).",
  "html": "<p>Version HTML du message.</p>"
}
```

| Champ | Type | Contraintes |
|-------|------|-------------|
| `to` | string | Email valide |
| `subject` | string | Minimum 3 caractères |
| `text` | string | Minimum 10 caractères |
| `html` | string | Non vide, nettoyé avant envoi |


## Déploiement

Le déploiement se fait via Wrangler :

```bash
pnpm deploy
```

La configuration est dans `wrangler.jsonc` :

- Nom du Worker : `makisend-poc`
- Point d’entrée : `src/index.ts`
- Compatibilité : `2026-07-10` avec le flag `nodejs_compat`
- Binding D1 : `makisend_db`

Avant de déployer, assure-toi que :

1. Les secrets sont configurés dans Cloudflare :
   ```bash
   pnpm wrangler secret put AES_256_KEY
   pnpm wrangler secret put BETTER_AUTH_SECRET
   pnpm wrangler secret put BETTER_AUTH_URL
   pnpm wrangler secret put FRONTEND_URL
   ```
2. La base D1 est créée et liée via `wrangler.jsonc`.
3. Les migrations sont appliquées.
4. La queue `makisend-send-email` et son DLQ existent (déclarées dans `wrangler.jsonc`).

> Les identifiants SMTP ne sont pas des secrets Worker : ils sont chiffrés dans D1 et gérés par utilisateur (module `smtp-config`).

---

## Sécurité

- **Authentification** : le middleware `api-key.middleware.ts` vérifie les clés API par utilisateur via Better Auth (`401` en-tête manquant, `403` clé invalide), avec `x-api-key: <KEY>` ou `Authorization: Bearer <KEY>`. Les clés sont créées/révoquées via le module `api-keys`. Les routes du dashboard utilisent la session Better Auth.
- **Mots de passe SMTP** : chiffrés au repos et jamais renvoyés par l'API (les réponses exposent uniquement l'identifiant, l'hôte, le port, le mode TLS, l'utilisateur et l'expéditeur).
- **Chiffrement** : l’adresse du destinataire est chiffrée avec AES-256-GCM avant stockage en base.
- **Nettoyage HTML** : le contenu HTML est nettoyé avec `sanitize-html` avant envoi.
- **TLS vérifié** : les connexions SMTP utilisent `rejectUnauthorized: true`.
- **Validation stricte** : les payloads sont validés avec Zod via `.strict()`, qui bloque les champs inattendus.

### Limites de sécurité actuelles

- **Rate limiting global mais non configurable par tenant** : Better Auth limite les tentatives de connexion et chaque clé API (10 000 requêtes/jour par défaut).
- Clés API par utilisateur mais sans scopes ni rotation automatique.
- Pas de webhook ou de signature de vérification d’origine.
- Pas de logs d’audit dédiés en dehors des logs applicatifs Pino.

---

## Limites et contraintes connues

### Liées au serverless

- **Temps d’exécution limité** : un envoi SMTP synchrone long peut échouer à cause des limites CPU des Workers.
- **Cold start** : la première invocation peut avoir une latence supplémentaire.
- **Coût** : les volumes importants ou les exécutions longues peuvent devenir coûteux.
- **Connexions longues inefficaces** : recréer une connexion SMTP à chaque requête Worker n’est pas optimal.

### Liées au POC

- Envoi **asynchrone** : `POST /send-email` répond `202 Accepted` dès la mise en file ; la délivrance (Cloudflare Queues → Workflow → SMTP) se fait ensuite et n’est visible que dans les logs D1.
- **Un seul fournisseur SMTP par configuration** : les identifiants sont stockés par utilisateur dans D1 (chiffrés), sans routage multi-fournisseur ni failover. Le port et le mode TLS sont configurables par configuration.
- **Retry borné** : une tentative SMTP initiale + **3 retries espacés de 30 s** dans le même workflow. Un échec permanent (auth, TLS, DNS, config, 5xx) s’arrête immédiatement ; après épuisement du budget, l’email passe à `failed` et part en DLQ. Le consumer Queue retente uniquement le démarrage du workflow (backoff exponentiel, puis DLQ).
- **Pas de tracking** : pas de suivi des bounces, ouvertures ou clics. Seuls les logs d’envoi sont stockés.
- **D1 est une base SQLite serverless** : latence possible, peu adaptée aux très gros volumes sans cache.
- **Délivrabilité** : SPF, DKIM, DMARC et réputation d’IP dépendent du fournisseur SMTP et du domaine expéditeur.

---

## Feuille de route

### POC (actuel)

- Endpoint `POST /send-email` avec authentification par clé API par utilisateur
- Pipeline asynchrone : Cloudflare Queues → Workflow durable → SMTP, avec retries bornés et DLQ
- Envoi via nodemailer + SMTP brut, port et TLS configurables par SMTP
- Templates réutilisables avec builder visuel React Email complet (inspecteur, thèmes, export) ou TSX collé, preview et variables ; logs chiffrés et idempotence HTTP
- Vérification de connexion SMTP à la demande + health check quotidien planifié
- Documentation OpenAPI 3.1 servie par Scalar (`/docs`, `/openapi.json`)
- Tests unitaires route / service / middleware + intégration
- CI GitHub Actions (lint, typecheck, tests, build frontend) sur les PR et pushes vers `main` et `dev`
- Test de déploiement sur Cloudflare Workers

### MVP interne

- ~~Sécurisation de l’endpoint~~ (fait : clés API par utilisateur via Better Auth)
- ~~Gestion des identifiants SMTP via D1 / seeding~~ (fait : module `smtp-config`, chiffrés)
- ~~Monitoring et métriques de délivrance~~ (fait : modules `dashboard` + `email-logs`)

### MVP public beta

- Files et jobs de messages : déjà en place (voir POC) — reste le réglage de l’échelle et du débit
- Gestion de l’échelle et du débit
- Améliorations de délivrabilité (anti-spam, SPF/DKIM/DMARC)

---

## Ressources utiles

- [Hono](https://hono.dev/)
- [Drizzle ORM](https://orm.drizzle.team/)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [nodemailer](https://nodemailer.com/)
