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
| `PORT` | Port SMTP de nodemailer (ex. `465`, `587`) |

Plus des variables d'environnement :

- **Identifiants SMTP** (`SMTP_USER`, `SMTP_PASSWORD`, `SENDER_EMAIL`, `HOST`) : stockés par utilisateur, chiffrés dans D1, gérés via le module `smtp-config`.
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

## Endpoints

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

- **Authentification** : le middleware `api-key.middleware.ts` vérifie les clés API par utilisateur via Better Auth (`401` en-tête manquant, `403` clé invalide), avec `x-api-key: <KEY>` ou `Authorization: Bearer <KEY>`. Les clés sont créées/révoquées via le module `api-keys`.
- **Chiffrement** : l’adresse du destinataire est chiffrée avec AES-256-GCM avant stockage en base.
- **Nettoyage HTML** : le contenu HTML est nettoyé avec `sanitize-html` avant envoi.
- **TLS vérifié** : les connexions SMTP utilisent `rejectUnauthorized: true`.
- **Validation stricte** : les payloads sont validés avec Zod via `.strict()`, qui bloque les champs inattendus.

### Limites de sécurité actuelles

- Pas de rate limiting.
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
- **Un seul fournisseur SMTP** : les identifiants sont stockés par utilisateur dans D1 (chiffrés), sans routage multi-fournisseur ni failover.
- **Retry borné** : chaque exécution du workflow fait **une seule tentative** — un échec fait échouer rapidement l’exécution, permettant de classifier l’erreur de nodemailer en interne. Échec transitoire → retour en file (5 cycles, backoff 1 min → 1 h), échec permanent (auth, TLS, DNS, config, 5xx) → abandon immédiat avec une raison lisible dans D1.
- **Pas de tracking** : pas de suivi des bounces, ouvertures ou clics. Seuls les logs d’envoi sont stockés.
- **D1 est une base SQLite serverless** : latence possible, peu adaptée aux très gros volumes sans cache.
- **Délivrabilité** : SPF, DKIM, DMARC et réputation d’IP dépendent du fournisseur SMTP et du domaine expéditeur.

---

## Feuille de route

### POC (actuel)

- Endpoint `POST /send-email` (authentification API key en TODO)
- Pipeline asynchrone : Cloudflare Queues → Workflow durable → SMTP, avec retour en file (5 cycles)
- Envoi via nodemailer + SMTP brut
- Logs chiffrés stockés dans D1
- Tests unitaires route / service / middleware
- CI GitHub Actions (lint + tests) sur les PR vers `main` et `dev`
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
