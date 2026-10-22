# MakiSend — Architecture de bout en bout

> **Statut :** POC. Ce document décrit le code tel qu'il existe sur la branche
> `feat/email-templates` (HEAD `47ef9e8`) et signale explicitement les limites
> connues. Ce n'est pas une spécification du produit cible (voir
> `FICHE_SUJET.md` pour la vision plus large).
>
> **Public :** ingénieurs, relecteurs et futurs mainteneurs qui doivent
> comprendre comment une requête devient un email délivré, et où se trouvent
> les points sensibles.

---

## 1. Ce qu'est MakiSend

MakiSend est une API d'emails transactionnels serverless déployée comme un
unique Worker Cloudflare. Elle existe pour répondre à trois questions :

1. Un backend utilisant **nodemailer + SMTP brut** peut-il tourner sur
   Cloudflare Workers ?
2. Peut-il fonctionner à l'échelle ?
3. Les emails peuvent-ils atterrir dans la boîte de réception plutôt que dans
   les spams ?

Le POC garde volontairement une surface produit réduite : s'authentifier avec
une clé API, accepter un email (HTML/texte inline ou template stocké),
persister un log en attente, mettre le travail en file et le délivrer de façon
asynchrone via un workflow durable. Un petit dashboard Astro (servi par le même
Worker) gère les identifiants SMTP, les clés API, les templates et les logs de
livraison.

**Hors périmètre du code actuel :** inscription multi-tenant, facturation,
scopes, webhooks, tracking bounce/open/click, failover multi-fournisseur,
automatisation de la délivrabilité (SPF/DKIM/DMARC) et rate limiting en bordure.

---

## 2. Contexte système

```
┌──────────────────────────┐        ┌───────────────────────────────┐
│ Client API (server-side) │        │ Navigateur (dashboard Astro)  │
│ x-api-key / Bearer       │        │ Cookie de session Better Auth │
└────────────┬─────────────┘        └──────────────┬────────────────┘
             │                                     │
             └──────────────────┬──────────────────┘
                                ▼
                 Cloudflare Worker `makisend-poc`
        ┌─────────────────────────────────────────────────────┐
        │ Binding Static Assets (frontend/dist)               │
        │ Application Hono                                    │
        │  /api/auth/*      → Better Auth (D1)                │
        │  /send-email      → auth clé API → D1 → Queue       │
        │  /smtp-config     → auth session → D1               │
        │  /api-keys        → auth session → D1 (Better Auth) │
        │  /templates       → auth session → D1               │
        │  /email-logs      → auth session → D1               │
        │  /dashboard/*     → auth session → D1               │
        │  queue()          → Workflows.create()              │
        └───────────┬───────────────────────┬─────────────────┘
                    │                       │
                    ▼                       ▼
          Cloudflare D1              Cloudflare Queue
          `makisend_db`              `makisend-send-email`
          (SQLite)                   + DLQ
                                            │
                                            ▼
                              Instance Cloudflare Workflow
                              `makisend-send-email`
                              (SendEmailWorkflow)
                                            │
                                            ▼
                              nodemailer → fournisseur SMTP
                              (TLS implicite, port 465 par défaut)
```

Il n'y a pas de déploiement frontend séparé ni de frontière CORS en
production : le Worker sert à la fois `frontend/dist` et l'API sur la même
origine. Le serveur de dev Astro (port 4321) proxifie les chemins API vers
Wrangler (port 8787) en développement local.

---

## 3. Topologie d'exécution et bindings

Le point d'entrée du Worker est `backend/src/index.ts`. Il exporte :

- `app` — l'application Hono (aussi utilisée par les tests via
  `app.request(...)`).
- `SendEmailWorkflow` — requis pour que Wrangler résolve le `class_name` du
  workflow.
- un objet par défaut avec `fetch: app.fetch` et `queue:
  sendEmailQueueConsumer`.

### 3.1 Bindings

| Binding | Type | Source | Rôle |
|---|---|---|---|
| `AES_256_KEY` | secret | secret Wrangler / `.dev.vars` | 64 caractères hex ; clé AES-256-GCM pour le destinataire + les champs SMTP |
| `BETTER_AUTH_SECRET` | secret | secret Wrangler / `.dev.vars` | Secret de signature Better Auth |
| `BETTER_AUTH_URL` | secret | secret Wrangler / `.dev.vars` | URL de base du Worker utilisée par Better Auth |
| `FRONTEND_URL` | secret | secret Wrangler / `.dev.vars` | Origine de confiance pour Better Auth / redirections |
| `PORT` | var | `wrangler.jsonc` (`"465"`) | Port SMTP passé à nodemailer |
| `makisend_db` | D1 | `wrangler.jsonc` | Base de données applicative |
| `SEND_EMAIL_QUEUE` | producteur Queue | `wrangler.jsonc` | Met les demandes d'envoi en tampon |
| `SEND_EMAIL_WORKFLOW` | binding Workflow | `wrangler.jsonc` | Démarre les exécutions durables |
| `ASSETS` | Fetcher | `wrangler.jsonc` | Frontend statique servi avant le script Worker |

`Bindings` est déclaré dans `backend/src/index.ts:39`. `worker-configuration.d.ts`
est généré par Wrangler et est actuellement obsolète/suivi par git ; ce n'est
pas la source de vérité — exécuter `pnpm cf-typegen` (voir le guide
développeur).

### 3.2 Ressources Cloudflare

`backend/wrangler.jsonc` :

- Worker `makisend-poc`, date de compatibilité `2026-07-10`, `nodejs_compat`.
- Base D1 `makisend-db`, binding `makisend_db`, migrations dans `./drizzle`.
- File producteur/consommateur `makisend-send-email`, DLQ
  `makisend-send-email-dlq`, `max_batch_size: 10`, `max_batch_timeout: 5`,
  `max_retries: 3`, `retry_delay: 30`.
- Workflow `makisend-send-email`, binding `SEND_EMAIL_WORKFLOW`, classe
  `SendEmailWorkflow`.
- `env.preview` duplique tout cela avec des noms `-preview` et sa propre D1.

---

## 4. Organisation du dépôt

```
makisend-poc/
├── backend/                  # Worker Cloudflare (package `makisend-poc`)
│   ├── src/
│   │   ├── index.ts          # Bindings, ordre des middlewares, DI, routes, exports
│   │   ├── api-keys/         # CRUD des clés API par utilisateur (Better Auth)
│   │   ├── config/           # Bindings → Config typée
│   │   ├── core/             # AppError, Pino, AES-GCM, sanitizer, bootstrap
│   │   ├── dashboard/        # Métriques agrégées de délivrance
│   │   ├── db/               # Schéma Drizzle + factory D1
│   │   ├── email-logs/       # Liste des logs + historique
│   │   ├── lib/auth.ts       # Instance Better Auth
│   │   ├── middleware/       # Clé API, session, config, erreurs, logs
│   │   ├── queue/            # Consommateur de file → workflow
│   │   ├── send-email/       # Orchestration HTTP → file + transport SMTP
│   │   ├── smtp-config/      # Identifiants SMTP chiffrés par utilisateur
│   │   ├── templates/        # CRUD des templates + renderer
│   │   └── workflows/        # SendEmailWorkflow durable
│   ├── drizzle/              # Migrations SQL + snapshots meta
│   ├── test/                 # Tests unitaires Vitest + intégration D1 Miniflare
│   ├── wrangler.jsonc
│   └── .env.example
├── frontend/                 # Dashboard Astro + React (package `frontend`)
│   ├── src/pages/            # /, /login, /register, /dashboard/*
│   ├── src/components/       # Îlots React (layouts, tables, formulaires)
│   ├── src/lib/api.ts        # Helper fetch same-origin
│   └── astro.config.mjs      # Proxy de dev vers le Worker
├── docs/                     # Cette documentation
├── Dockerfile / docker-compose.yml
└── .github/workflows/        # CI (lint + tests) et Deploy
```

Le backend suit un **pattern modulaire inspiré de NestJS** :

- **Controller** — HTTP uniquement : validation, lecture du contexte, forme de
  la réponse.
- **Service** — règles métier, vérifications de propriété, orchestration.
- **Repository** — persistance Drizzle/D1 derrière une interface.
- **DTO** — schémas Zod + types inférés.
- **Barrel `index.ts`** — surface publique du module.

`send-email` fait exception : il n'a pas de couche service. Le controller
parle directement au repository et à la file, et le workflow possède
l'orchestration de la livraison.

---

## 5. Cycle de vie d'une requête

### 5.1 Ordre des middlewares (`backend/src/index.ts`)

1. **CORS** — `origin: (origin) => origin`, `credentials: true`,
   `allowHeaders: ["Content-Type", "Authorization"]`, méthodes
   GET/POST/PUT/DELETE/OPTIONS (`index.ts:128`).
2. **Request logger** — logue méthode, URL, statut et durée via Pino
   (`middleware/request-logger.middleware.ts`).
3. **Gestionnaire d'erreurs global** — enregistré avec `app.onError(errorHandler)`.
4. **Middleware de config** — `createConfig(c.env)` valide `AES_256_KEY`
   (64 caractères hex) et `makisend_db`, puis stocke la `Config` typée dans
   `c.get("appConfig")` (`middleware/config.middleware.ts`, `config/config.ts`).
5. **Routes Better Auth** — `POST /api/auth/sign-up/email` est traité
   spécialement (voir §6.1) ; toute autre requête `/api/auth/*` est transmise
   brute à `auth.handler()`. Les en-têtes CORS sont réappliqués à la réponse
   brute car un middleware Hono ne peut pas les injecter dans une Response
   renvoyée par Better Auth.
6. **Middleware clé API** — uniquement `/send-email/*` ; vérifie la clé et
   charge l'utilisateur + la configuration SMTP de l'appelant.
7. **Initialisation paresseuse des dépendances** — à la première requête,
   construit la base Drizzle et tous les singletons repositories/services
   (objet `deps`, `index.ts:81`).
8. **Controllers de routes** — montés dans cet ordre : `/send-email`,
   `/smtp-config`, `/api-keys`, `/email-logs`, `/dashboard`, `/templates`.
   Les routes dashboard sont enveloppées dans `sessionMiddleware`.
9. **Gestionnaire d'erreurs** — `AppError` renvoie son code et son message ;
   toute autre erreur renvoie `500` avec `error.message` (ou
   `"Internal Server Error"`).

Noter que l'initialiseur paresseux est enregistré *après* le middleware
`/send-email` mais avant les controllers, donc il s'exécute pour toute requête
qui atteint un controller.

### 5.2 Injection de dépendances

Il n'y a pas de conteneur IoC. `deps` est un objet au niveau module contenant
des repositories/services nullables et deux initialiseurs idempotents :

- `initDb(env)` — `createDatabase(env.makisend_db)`, construit les
  repositories, met en cache `env.AES_256_KEY`, positionne `dbInitialized`.
- `initServices()` — construit les services avec les repositories + la clé AES.

Les controllers reçoivent des **fonctions getter** (`() => deps.emailRepository!`)
afin de résoudre le singleton au moment de la requête, pas au chargement du
module. L'instance d'auth est mise en cache séparément et recréée quand
`BETTER_AUTH_URL` ou `FRONTEND_URL` change (`getAuthInstance`, `index.ts:67`).

C'est sûr par requête dans Workers car l'état module est par isolate, mais cela
signifie qu'un changement de `AES_256_KEY` ou du binding DB sans redéploiement
ne sera pas pris en compte par un isolate déjà chaud. Cela signifie aussi que
la clé de cache de l'auth n'inclut pas `BETTER_AUTH_SECRET`.

---

## 6. Authentification et autorisation

MakiSend a deux plans d'authentification indépendants.

### 6.1 Auth de session du dashboard (Better Auth)

`backend/src/lib/auth.ts` configure Better Auth avec :

- Adaptateur Drizzle (`provider: "sqlite"`, `transaction: false`).
- Email/mot de passe activé.
- `changeEmail.updateEmailWithoutVerification: true` (aucun flux de
  vérification n'est configuré, donc la page settings peut changer l'email
  immédiatement).
- `deleteUser.beforeDelete` supprime les `email_logs` de l'utilisateur avant
  que Better Auth ne supprime l'utilisateur. C'est requis car
  `email_logs.userId` n'a pas de FK vers `user` et bloquerait sinon la cascade
  `user → smtp_config → apikey`.
- `trustedOrigins: [FRONTEND_URL]`.
- Cookies par défaut `SameSite=None; Secure` (Workers et Pages sont des sites
  différents dans un déploiement séparé ; le déploiement same-origin actuel
  utilise quand même ce réglage).
- Plugin clé API : préfixe `mk_`, rate limit 10 000 requêtes/jour par clé.

L'inscription est **fermée après le premier utilisateur**. La route spéciale à
`index.ts:158` compte les lignes de `user` ; s'il en existe une, elle renvoie
`403 {"error":"Registration is closed"}`. Sinon elle injecte un `name` (la
partie locale de l'email) car Better Auth l'exige alors que l'UI ne demande que
email + mot de passe, puis transmet la requête à `auth.handler()`.

`sessionMiddleware` appelle `auth.api.getSession({ headers })`, rejette avec
`401 Unauthorized` sans session, et positionne `c.get("userId")`.

### 6.2 Auth par clé API (clients machine)

`apiKeyMiddleware` (`middleware/api-key.middleware.ts`) :

1. Lit `x-api-key`, ou `Authorization: Bearer <key>`.
2. Absent → `401` ; invalide → `403`.
3. Appelle `auth.api.verifyApiKey({ body: { key } })`.
4. `result.key.referenceId` est l'id de l'utilisateur propriétaire ; charge
   l'utilisateur.
5. Charge `apikey.smtpConfigId` et la ligne `smtp_config` référencée.
6. Déchiffre les quatre champs SMTP et les place dans le contexte, avec
   `userId`, `apiKeyId`, `smtpConfigId`.

Chaque clé API est liée à exactement une configuration SMTP
(`apikey.smtpConfigId` est `UNIQUE`), et supprimer cette configuration
cascade vers la clé. Une clé API sans config liée est rejetée avec
`403 "API key has no SMTP configuration"`.

Les identifiants déchiffrés placés dans le contexte ne sont **pas utilisés**
par le controller send-email ; il ne transmet que `smtpConfigId` et le workflow
re-résout et déchiffre la config. Le déchiffrement du middleware est donc
redondant aujourd'hui.

### 6.3 Règles de propriété

- Le CRUD SMTP config, template et clé API est limité au `userId` de session.
  Un accès inter-utilisateur renvoie `403` pour le CRUD, sauf `templateId` au
  moment de l'envoi qui renvoie `404` pour éviter de sonder l'existence.
- `POST /send-email` dérive `userId` et `smtpConfigId` de la clé API, pas du
  body (le body est `.strict()` et ne contient pas ces champs).
- Les lectures `email_logs` sont filtrées par `userId`.

---

## 7. Modèle de données

Schéma : `backend/src/db/schema.ts`. Migrations : `backend/drizzle/*.sql`
(générées par `drizzle-kit generate`).

### 7.1 Tables

| Table | Colonnes clés | Notes |
|---|---|---|
| `user` | `id` PK, `email` unique, `name`, `emailVerified`, timestamps | Better Auth |
| `session` | `id` PK, `token` unique, `userId` FK cascade, `expiresAt` | Better Auth |
| `account` | `id` PK, `userId` FK cascade, `providerId`, `password` | Hash du mot de passe Better Auth |
| `verification` | `id` PK, `identifier`, `value`, `expiresAt` | Better Auth |
| `smtp_config` | `id` PK, `userId` FK cascade, `smtphostname`, `smtpusername`, `smtppassword`, `sender_email` chiffrés, `isActive` | Une ligne par compte SMTP |
| `apikey` | colonnes Better Auth + `referenceId` (= user id), `key` (hashé par Better Auth), `prefix`, `smtpConfigId` FK unique cascade | Une clé ↔ une config SMTP |
| `templates` | `id` PK, `userId` FK cascade, `name`, `subject`, `html`, `text` | Contenu en clair avec `{{variables}}` |
| `email_logs` | `internalId` PK (cuid2), `userId`, `apiKeyId` FK set null, `to` chiffré, `subject`, `smtpId`/`sentAt` nullables, `emailProcessingTimeMs`, `createdAt` texte ISO | Ligne pending créée à l'enqueue |
| `email_histories` | `id` PK, `emailId` (sans FK), `status`, `error`, `attempts`, `createdAt` | Timeline append-only |

Index :

- `email_logs(userId, createdAt)` et `email_logs(apiKeyId)`.
- `email_histories(emailId, createdAt)`.
- `smtp_config(userId)`, `templates(userId)`, `apikey(configId)`,
  `apikey(referenceId)`, `apikey(key)`.
- Index Better Auth sur `session(userId)`, `account(userId)`,
  `verification(identifier)`.

### 7.2 Relations et comportement à la suppression

```
user 1 ──< session
user 1 ──< account
user 1 ──< smtp_config 1 ──< apikey (smtpConfigId UNIQUE)
user 1 ──< templates
user 1 ──< email_logs (userId est une simple colonne, sans FK)
apikey 1 ──< email_logs (apiKeyId, ON DELETE SET NULL)
email_logs 1 ──< email_histories (emailId, sans FK)
```

Conséquences :

- Supprimer une config SMTP cascade vers sa clé API ; `email_logs.apiKeyId`
  devient `NULL`, donc les logs survivent mais perdent le lien à la config.
- Supprimer un utilisateur : le `beforeDelete` de Better Auth purge les
  `email_logs` ; la cascade supprime sessions, accounts, configs SMTP, clés API
  et templates. Les lignes `email_histories` ne sont **pas** supprimées car
  elles n'ont pas de FK — elles deviennent orphelines.
- Des lignes `email_logs` peuvent exister sans clé API ni config SMTP.

### 7.3 Chiffrement

`backend/src/core/crypto.ts` :

- AES-256-GCM via Web Crypto.
- Clé : 64 caractères hexadécimaux (`openssl rand -hex 32`).
- Format du chiffré : `JSON.stringify({ iv: "<hex>", data: "<hex>" })`.
- Un IV aléatoire frais de 12 octets est généré à chaque appel `encrypt()`.
- Les chaînes vides passent telles quelles (`encrypt("") === ""`), et
  `decrypt("")` renvoie `""`.

Champs chiffrés :

- `email_logs.to`
- `smtp_config.smtpHostname`, `smtpUsername`, `smtpPassword`, `senderEmail`

Champs en clair : `email_logs.subject`, sujet/html/texte des templates, messages
d'erreur/historique, email/nom utilisateur, métadonnées de clé API.

Il n'y a **aucune version ni rotation de clé** : changer `AES_256_KEY` rend
tout chiffré existant indéchiffrable. Il n'y a pas d'identifiant de clé dans le
payload.

---

## 8. Catalogue des modules

| Module | Routes | Auth | Responsabilité |
|---|---|---|---|
| `send-email` | `POST /send-email` | Clé API | Valider le payload, résoudre le template, créer le log pending, enfiler |
| `templates` | `GET/POST /templates`, `GET/PUT/DELETE /templates/:id` | Session | CRUD + propriété ; helpers de rendu |
| `smtp-config` | `GET/POST /smtp-config`, `GET/PUT/DELETE /smtp-config/:id` | Session | CRUD ; chiffre/déchiffre les identifiants |
| `api-keys` | `GET/POST /api-keys`, `DELETE /api-keys/:id` | Session | Créer une clé Better Auth, la lier à une config SMTP, lister/révoquer |
| `email-logs` | `GET /email-logs`, `GET /email-logs/:id` | Session | Logs filtrés/paginés + timeline d'historique |
| `dashboard` | `GET /dashboard/{stats,by-config,recent,errors}` | Session | Métriques agrégées |
| `queue` | handler `queue()` | Cloudflare | Démarre un workflow par message |
| `workflows` | `SendEmailWorkflow` | Cloudflare | Cinq étapes durables + décision de retry |
| `lib/auth` | `/api/auth/*` | — | Instance Better Auth et config du plugin |
| `middleware` | tout | — | CORS/config/erreurs/logs/auth |
| `core` | — | — | Erreurs, logger, crypto, sanitizer, bootstrap legacy |

### 8.1 `send-email`

Fichiers : `send-email.controller.ts`, `send-email.dto.ts`,
`send-email.repository.ts`, `send-email.types.ts`, `transport-resolver.ts`,
`error-classifier.ts`, `index.ts`.

- DTO : un endpoint, deux formes mutuellement exclusives via `z.union` :
  - `SendEmailDto` : `to`, `subject` (min 3, **sans max**), `text`
    (10–20 000), `html` (1–100 000), `.strict()`.
  - `SendTemplateEmailDto` : `to`, `templateId`, `variables` optionnel
    (record string/number/boolean converti en string), `.strict()`.
- Repository : `createPendingEmailLog`, `completeEmailLog`,
  `saveEmailHistory`.
- Transport : `SmtpEmailTransport` (`send-email/index.ts`) crée un transport
  nodemailer avec `secure: true`, `family: 4`, `rejectUnauthorized: true`,
  des timeouts connexion/greeting/socket de 5s/5s/10s. Il n'appelle **pas**
  `transporter.close()` (retiré dans `47ef9e8` ; les timeouts sont le filet de
  sécurité contre les blocages).
- `transport-resolver.ts` construit un transport frais par exécution de
  workflow depuis la config référencée par l'événement. Sans `smtpConfigId`, il
  retombe sur la première config active, puis n'importe quelle config —
  comportement legacy sans vérification d'utilisateur.
- `error-classifier.ts` est couvert au §10.

### 8.2 `templates`

- CRUD limité à `userId` ; un CRUD inter-utilisateur renvoie `403`.
- Caps DTO : name 100, subject 500, html 100 000, text 20 000.
- `template-renderer.ts` :
  - `VARIABLE_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g`
  - `extractVariables(...contents)` renvoie les noms uniques dans l'ordre de
    première apparition.
  - `renderTemplate` insère les valeurs littéralement (sujet, texte).
  - `renderHtmlTemplate` échappe `& < > " '` avant insertion.
  - Les marqueurs inconnus restent intacts quand la fonction est appelée
    directement.

### 8.3 `smtp-config`

- DTO : hostname, username, password, sender email ; la mise à jour accepte
  aussi `isActive`.
- Le service chiffre à la création/mise à jour et déchiffre chaque
  enregistrement retourné.
- `GET /smtp-config` et `GET /smtp-config/:id` renvoient donc le
  `smtpPassword` déchiffré au navigateur. Le dashboard l'ignore, mais il est
  exposé à tout script disposant d'une session valide (voir §13).

### 8.4 `api-keys`

- `POST` exige `smtpConfigId` et un `name` optionnel.
- Le repository vérifie que la config appartient à l'utilisateur, crée une clé
  Better Auth (`prefix: "mk_"`), puis trouve la clé la plus récente de
  l'utilisateur et met à jour `smtpConfigId`. Cette recherche de "dernière clé"
  est sujette aux races en création concurrente.
- Une config SMTP absente/étrangère lève une `Error` simple → le gestionnaire
  global renvoie `500`, pas `404/403`.
- `GET` renvoie les métadonnées (jamais le secret) ; la clé complète n'est
  renvoyée qu'à la création.

### 8.5 `email-logs`

- Filtres : `smtpConfigId`, `to`, `status`, `limit` (1–100, défaut 50),
  `cursor`.
- Pagination keyset sur `(createdAt, internalId) DESC` ; récupère `limit + 1`
  pour calculer `nextCursor`.
- L'historique est attaché avec une seule requête `IN (...)` (max 100 ids,
  limite de paramètres liés D1).
- `to` est chiffré, donc le filtre `to` s'exécute **après** déchiffrement et
  uniquement sur la page récupérée.
- `status` utilise `EXISTS` sur `email_histories` ; `attempt_failed` n'est pas
  une valeur de filtre acceptée.
- `smtpConfigId` utilise une sous-requête sur `apikey` ; les logs dont la clé a
  été supprimée sont invisibles à ce filtre.
- L'encodage du curseur est cassé : `encodeCursor` écrit
  `"<createdAt ISO>:<internalId>"`, mais `decodeCursor` coupe au **premier**
  `:`, qui se trouve dans l'heure (`2026-10-19T09:11:...`). Le `createdAt`
  décodé devient `"2026-10-19T09"` et l'id devient le reste, donc la page
  suivante saute des lignes. Le frontend ne pagine pas, ce qui masque le bug.
- `findById` lève une `Error` simple pour un log absent/étranger → `500`.

### 8.6 `dashboard`

- `GET /dashboard/stats?days=7` (défaut 7, max 365) : `totalSent`,
  `successCount`, `failureCount`, `successRate`.
  - Les comptes sont des `COUNT(DISTINCT internalId)` sur `email_logs LEFT JOIN
    email_histories`.
  - Un email qui a échoué puis réussi apparaît dans **les deux** comptes
    succès et échec.
  - Le dénominateur du taux de succès est tous les logs de la fenêtre, y
    compris les pending, donc il peut être plus bas qu'attendu.
- `GET /dashboard/by-config` : groupe par config SMTP, mais utilise un
  **inner join** sur `apikey`, donc les configs sans clé sont omises.
- `GET /dashboard/recent` : dernier statut via sous-requête corrélée.
- `GET /dashboard/errors` : groupe les erreurs d'historique `failed`.
- Le frontend appelle `/dashboard/stats` (sans `days`, donc le défaut API de
  7 jours s'applique alors que la carte affiche "All time"),
  `/dashboard/stats?days=N` pour le graphique, et `/dashboard/errors?days=N`
  pour la carte d'erreurs. `/dashboard/by-config` et `/dashboard/recent` sont
  implémentés mais inutilisés. Le graphique **fabrique** une distribution
  quotidienne en divisant les totaux de la fenêtre équitablement ; l'API
  n'expose pas de série temporelle.

---

## 9. Flux d'envoi de bout en bout

### 9.1 Email inline

```
POST /send-email
  Authorization: Bearer mk_...        (ou x-api-key)
  { to, subject, text, html }
        │
        ▼
apiKeyMiddleware
  vérifie la clé → user → apikey.smtpConfigId → smtp_config
  set userId, apiKeyId, smtpConfigId (et identifiants déchiffrés)
        │
        ▼
zValidator(SendEmailPayloadDto)  → 400 si invalide/mélangé
        │
        ▼
emailId = createId()
encrypt(to, AES_256_KEY)
INSERT email_logs (pending : smtpId/sentAt NULL)
        │
        ▼
SEND_EMAIL_QUEUE.send({
  name: "app/send-email",
  data: { to, subject, text, html, emailId, userId, apiKeyId,
          smtpConfigId, queueCycles: 0 }
})
        │
        ├── échec → saveEmailHistory("failed", "Failed to enqueue: ...") → 500
        └── succès → 202 { success: true, message: "Email queued" }
```

La ligne pending est créée **avant** l'enqueue pour que l'email soit visible
dans le dashboard même si la file ou toutes les étapes suivantes échouent.

### 9.2 Email avec template

La requête suit le même chemin jusqu'à la validation. Ensuite :

1. `templateRepo.findById(payload.templateId)`.
2. Absent **ou** appartenant à un autre utilisateur → `404 "Template not
   found"` (anti-sondage).
3. `extractVariables(subject, html, text)`.
4. Variables manquantes → `400 "Missing template variables: a, b"`.
   - La vérification est `!(name in variables)`, donc les noms de prototype
     comme `toString` comptent comme fournis même s'ils sont absents.
5. Rendu :
   - sujet : substitution littérale.
   - texte : substitution littérale.
   - html : valeurs échappées HTML, puis la sanitization normale du workflow
     s'exécute.
6. Le résultat rendu est renvoyé sous la même forme inline `SendEmailDto`.
   La file, le consommateur, le workflow et la couche SMTP n'apprennent jamais
   que les templates existent.

La sortie rendue n'est **pas re-validée** contre les caps inline. Un template
dans les caps peut produire plus de 100 000 caractères (ou une valeur de
variable peut être arbitrairement grande), et le message de file résultant peut
approcher la limite de 128 Ko de Cloudflare Queues. Il n'y a pas de
vérification de taille explicite avant `queue.send()`.

### 9.3 Consommateur de file

`backend/src/queue/send-email.consumer.ts` :

Pour chaque message du batch :

1. `env.SEND_EMAIL_WORKFLOW.create({ id: `${emailId}-${queueCycles}`, params })`.
2. `msg.ack()` seulement après le succès de `create()`.
3. En cas d'échec : log, et si `msg.attempts >= 4` écrit une ligne
   d'historique `failed` (`"Failed to start workflow after N attempts: ..."`).
4. `msg.retry({ delaySeconds: 5 * 2^attempts, plafonné à 300 })`.

Le format d'id d'instance est une clé d'idempotence : Workflows rejette les ids
dupliqués, donc une redélivrance ne peut pas démarrer une seconde exécution
pour le même `emailId + queueCycles`. Le séparateur `-` est requis car les ids
Workflow n'autorisent que `[a-zA-Z0-9-_]` et les ids cuid2 sont alphanumériques
minuscules.

Configuration de la file (`wrangler.jsonc`) : `max_retries: 3` (4 livraisons),
`retry_delay: 30`, DLQ `makisend-send-email-dlq`. `FINAL_ATTEMPT = 4` dans le
consommateur doit rester synchronisé avec `max_retries`.

### 9.4 Étapes du workflow

`backend/src/workflows/send-email.workflow.ts`, classe `SendEmailWorkflow` :

Avant toute étape, `resolveTransportFor(env, data.smtpConfigId)` s'exécute
**hors** de `step.do`. Une config absente ou un échec de déchiffrement échoue
donc rapidement dans le classifier sans checkpoint d'une exécution condamnée.

| # | Étape | Travail | Historique écrit |
|---|---|---|---|
| 1 | `email-received-and-update-history` | log + marque received | `received` |
| 2 | `processing` | marque processing | `processing` |
| 3 | `cleaning-html-input` | `cleanHtml(data.html)` ; renvoie la chaîne nettoyée | `cleaned` |
| 4 | `send-mail-via-nodemailer` | `transport.send(...)` ; **`retries: { limit: 0 }`** | `sent` en succès, `attempt_failed` en erreur |
| 5 | `save-infos-in-db` | `completeEmailLog(emailId, messageId, sentAt, durationMs)` | — (ligne de log mise à jour) |

L'étape 4 renvoie `JSON.stringify({ messageId, durationMs })` et l'étape 5 le
parse. Les étapes doivent renvoyer des primitives : renvoyer un objet depuis
`step.do` déclenche une fausse annulation "code had hung" dans workerd
(workerd#6925 / workers-sdk#14959). L'étape 3 renvoie une chaîne pour la même
raison.

L'étape SMTP désactive délibérément les retries par défaut de Workflows (5).
SMTP n'est pas idempotent : un auto-retry après un ack perdu pourrait envoyer
l'email deux fois. `retries: { limit: 0 }` garantit aussi que le `catch`
extérieur voit l'erreur et peut la classifier pour l'échelle des cycles de
file.

En succès, l'exécution renvoie
`{ outcome: "sent", messageId, durationMs, attempt }`. Sur toute exception,
l'exécution construit `{ code, message }` et appelle
`resolveSendEmailRunEnd(...)`.

### 9.5 Machine à états des retries et de la classification

Il y a **deux systèmes de retry indépendants**.

| Couche | Propriétaire | Budget | Déclencheur |
|---|---|---|---|
| Queue → Workflow | consommateur de file + `max_retries: 3` | 4 livraisons → DLQ | `SEND_EMAIL_WORKFLOW.create()` lève |
| Étapes 1,2,3,5 du workflow | défauts Workflows | 5 retries chacune | l'étape lève |
| Étape SMTP 4 | `retries: { limit: 0 }` | exactement 1 | l'étape lève |
| Workflow → Queue | `resolveSendEmailRunEnd` | 5 cycles (6 tentatives SMTP max) | échec SMTP/config transitoire |

`resolveSendEmailRunEnd` (`send-email.workflow.ts:89`) décide dans cet ordre :

1. **Pas de `emailId`** → abandon (`"no emailId in payload"`).
2. **`queueCycles >= MAX_QUEUE_CYCLES` (5)** → écrit `failed`
   (`"Delivery abandoned after 5 queue cycles. Last error: <friendly>"`) et
   abandonne.
3. **Le classifier dit `permanent`** → écrit `failed` avec le message lisible
   et abandonne.
4. **Binding de file absent** → écrit `failed` et abandonne.
5. **Transitoire** → `SEND_EMAIL_QUEUE.send({ ...data, queueCycles:
   nextCycle }, { delaySeconds })` ; écrit une ligne d'historique
   `attempt_failed` best-effort
   (`"Re-queued: next attempt in Ns (cycle X of 5). Last error: ..."`) ;
   renvoie `requeued`.
   - Si le ré-enqueue lève → écrit `failed` et abandonne.

Échelle de backoff : `[60, 300, 900, 1800, 3600]` secondes, indexée par le
cycle courant et plafonnée à la dernière entrée. Cycle 0→1 attend 60s, 4→5
attend 3600s.

Le type de résultat est l'un de :

```ts
{ outcome: "sent"; messageId; durationMs; attempt }
{ outcome: "requeued"; nextCycle; delaySeconds }
{ outcome: "abandoned"; reason }
```

#### Règles de classification

`error-classifier.ts` :

1. `responseCode` numérique : `< 500` → transitoire ; `>= 500` → permanent.
2. Statut SMTP extrait du message avec `/: ([45]\d{2})[ -]/` : `< 500` →
   transitoire ; `>= 500` → permanent.
3. Code depuis `err.code`, sinon le premier token connu `E[A-Z_]+` du message.
   L'ensemble permanent gagne sur le transitoire quand les deux apparaissent.
4. Défaut → **transitoire** (borné par le plafond de cycles).

Codes permanents : `EAUTH`, `ENOAUTH`, `EOAUTH2`, `ECONFIG`, `ETLS`,
`EREQUIRETLS`, `EPROTOCOL`, `EDNS`, `ENOTFOUND`, `EENVELOPE`,
`EMAXRECIPIENTS`, `EMESSAGE`, `EFILEACCESS`, `EURLACCESS`, `EPROXY`.

Codes transitoires : `ECONNECTION`, `ETIMEDOUT`, `ESOCKET`, `EMAXLIMIT`,
`ESTREAM`, `EFETCH`, `EAI_AGAIN`.

`friendlyErrorMessage` mappe les codes vers un texte destiné à l'utilisateur.
Cas notables :

- `EAUTH`/`ENOAUTH` → vérifier le nom d'utilisateur/mot de passe SMTP.
- `EDNS`/`ENOTFOUND` → hôte introuvable.
- `ETLS` → vérifier le port/mode de chiffrement (465 TLS implicite, 587
  STARTTLS).
- `ECONNECTION`/`ESOCKET` → si le message contient "port 25 is blocked", le
  dire explicitement ; sinon vérifier hôte/port/fournisseur.
- `ETIMEDOUT` → le serveur n'a pas répondu.
- `EENVELOPE`/`EMESSAGE` → temporaire vs permanent selon le statut SMTP.
- Statut 5xx → "permanently rejected (status N)" sans transmettre la réponse
  brute du fournisseur.
- Inconnu → "delivery failed unexpectedly" générique.

Cas limite important : une configuration SMTP absente est levée comme
`AppError(404, "SMTP configuration not found")`. Elle n'a ni `code` ni statut
SMTP, donc le classifier par défaut la classe **transitoire** et l'email
consomme toute l'échelle de 5 cycles avant abandon. Il en va de même pour tout
bug ou erreur inattendue sans code.

#### Livraison at-least-once

Le pipeline est at-least-once, pas exactly-once :

- Si SMTP accepte le message mais que l'étape 5 (ou l'écriture d'historique
  `sent`) échoue, le workflow peut réessayer l'étape 5, ou l'exécution peut
  échouer et être ré-enfilée.
- Il n'y a pas de clé d'idempotence fournisseur ni de table de déduplication.
- Un envoi en double est donc possible après un crash entre le succès SMTP et
  le reçu en base.

---

## 10. Chemins de lecture : logs et dashboard

### 10.1 Logs d'email

`EmailLogRepository.findPageByUserId` construit :

- `userId = ?`
- sous-requête `smtpConfigId` optionnelle
- `EXISTS` de statut optionnel
- curseur keyset optionnel
- `ORDER BY createdAt DESC, internalId DESC LIMIT pageSize + 1`

`attachHistory` charge ensuite tout l'historique de la page en une requête et
le groupe en mémoire. Le service déchiffre `to` après récupération et applique
le filtre `to` à cette page.

`GET /email-logs/:id` charge un log et son historique ; `findById` lève une
`Error` simple pour une ligne absente/étrangère, donc le client voit `500` au
lieu de `404/403`.

### 10.2 Dashboard

- Les stats sont agrégées en SQL sur la fenêtre (`days`, défaut 7).
- `by-config` fait un inner join sur `apikey` ; les configs sans clé
  disparaissent.
- `recent` sélectionne le dernier statut d'historique par log avec une
  sous-requête corrélée.
- `errors` groupe les lignes d'historique `failed` par texte d'erreur.
- Il n'y a pas d'endpoint de série temporelle. Le graphique du frontend divise
  les totaux sur les jours, produisant une courbe plate/artificielle.

---

## 11. Modèle de sécurité

### 11.1 Contrôles présents

- **Clés API par utilisateur** vérifiées par Better Auth ; préfixe `mk_` ;
  10 000 requêtes/jour par clé (rate limit Better Auth).
- **Auth de session** pour toutes les API dashboard ; cookies
  `SameSite=None; Secure` ; `trustedOrigins` restreint à `FRONTEND_URL` pour
  Better Auth.
- **AES-256-GCM** au repos pour les adresses destinataires et tous les champs
  SMTP.
- **Vérification TLS** (`rejectUnauthorized: true`) et IPv4 forcé.
- **Sanitization HTML** avec une allowlist restrictive avant envoi SMTP.
- **Zod `.strict()`** sur tous les endpoints d'écriture.
- **Vérifications de propriété** dans les services ; le sondage de template
  renvoie le même 404 pour un id absent et étranger.
- **Inscription fermée** après le premier utilisateur.
- **Aucun secret dans le dépôt** (`.dev.vars`, `.env` ignorés).

### 11.2 Écarts et risques

| Sévérité | Écart | Impact |
|---|---|---|
| Élevée | CORS reflète n'importe quelle `Origin` et autorise les credentials | Tout site peut faire des requêtes créditées vers les API dashboard si le navigateur envoie le cookie ; combiné à `SameSite=None`, c'est une exposition CSRF. |
| Élevée | `allowHeaders` omet `x-api-key` | Les appels navigateur cross-origin utilisant l'en-tête documenté `x-api-key` échouent au preflight. `Authorization` fonctionne. |
| Élevée | `GET /smtp-config` renvoie `smtpPassword` déchiffré | Toute session (ou XSS) peut lire les identifiants SMTP ; l'UI n'en a pas besoin. |
| Élevée | La D1 prod/preview est effacée à chaque déploiement | Perte de données par design pendant l'itération POC ; inacceptable pour de vrais utilisateurs. |
| Moyenne | Le gestionnaire d'erreurs renvoie `error.message` brut pour les 500 non gérés | Des détails internes (SQL, texte fournisseur) peuvent fuiter vers les clients. |
| Moyenne | Pino logue les adresses destinataires en clair et les query strings complètes | PII dans les logs ; pas de request id ni de redaction. |
| Moyenne | L'historique `attempt_failed` stocke le texte SMTP brut | Noms d'hôtes/éléments destinataires visibles dans le dashboard. |
| Moyenne | Pas de rotation/version de clé | Changer `AES_256_KEY` détruit toutes les données chiffrées. |
| Moyenne | Une config SMTP absente retente 5 cycles | Travail file/workflow gaspillé pour une erreur de configuration permanente. |
| Moyenne | La vérification des variables de template utilise `in` | Les noms de prototype (`toString`, `constructor`) passent la validation et rendent `undefined`. |
| Moyenne | La sortie rendue du template n'est pas re-plafonnée | Peut dépasser la limite de 128 Ko de la file et échouer à l'enqueue. |
| Moyenne | Le fallback `findSmtpRecord` ne vérifie pas l'utilisateur | Les événements legacy sans `smtpConfigId` peuvent utiliser la config active d'un autre tenant. |
| Faible | `secure: true` codé en dur | Le port 587/STARTTLS ne peut pas fonctionner sans changement de code. |
| Faible | `Bindings.PORT` typé `number` mais les vars Wrangler sont des chaînes ; la config ne le valide pas | Incohérence de type à l'exécution ; nodemailer peut coercer. |
| Faible | Le cache d'instance auth ignore `BETTER_AUTH_SECRET` | Une rotation de secret dans un isolate chaud n'est pas prise en compte. |
| Faible | `email_logs.userId` n'a pas de FK | Logs orphelins si le hook de suppression utilisateur est contourné. |
| Faible | `email_histories` orphelins à la suppression utilisateur | Croissance illimitée des orphelins. |
| Faible | Bug de curseur `email-logs` | La pagination saute des lignes ; masqué par l'UI actuelle. |
| Faible | Les stats dashboard double-comptent et incluent les pending au dénominateur | Taux de succès trompeur. |
| Faible | Pas de rate limiting en bordure au-delà de la limite par clé de Better Auth | Une clé valide peut quand même faire des rafales ; pas de plafond par IP ou par utilisateur. |
| Faible | Aucune gestion DKIM/SPF/DMARC | La délivrabilité dépend entièrement du fournisseur/domaine. |

---

## 12. Observabilité

- **Pino** (`core/logger.ts`) écrit des lignes JSON sur `console.log` — la
  destination compatible edge ; pas de transport Node, pas de `pino-pretty`
  dans le Worker.
- Les logs de requête incluent méthode, URL, statut et durée. Il n'y a pas de
  request id, trace id ou user id sur la ligne de log de requête.
- Le code workflow/file logue `receiver`, `emailId`, `smtpId`, la tentative et
  les durées. Les adresses destinataires sont en clair.
- La timeline métier vit dans `email_histories` : `received` → `processing` →
  `cleaned` → `sent` (ou `attempt_failed` → ... → `failed`).
- `wrangler.jsonc` active Workers Logs (`observability.logs`) et désactive les
  traces.
- Il n'y a ni métriques, ni alerting, ni dashboards, ni outillage d'inspection
  de DLQ dans le dépôt. La DLQ existe mais rien ne la consomme ni ne la
  remonte.

---

## 13. Architecture frontend

- Les pages Astro 7 montent des îlots React 19 avec `client:load`.
- Pages : `/` (marketing), `/login`, `/register`, et `/dashboard/{index,
  email-logs, templates, smtp-config, api-keys, settings}`.
- `SessionGuard` vérifie `/api/auth/get-session` dans le navigateur et
  redirige vers `/login` ; c'est client-side uniquement, donc le HTML protégé
  est brièvement servi avant la redirection. La vraie protection est côté
  serveur sur l'API.
- `fetchApi(path, init)` appelle `fetch(path, { credentials: "include",
  ...init })` — same-origin en production, proxy Vite en dev.
- Le proxy de dev transmet `/api`, `/smtp-config`, `/api-keys`, `/email-logs`,
  `/templates` et les quatre chemins `/dashboard/*` vers `BACKEND_URL`
  (`http://localhost:8787` par défaut, `http://backend:8787` dans Docker).
- La page templates duplique la regex `{{variable}}` et l'échappement HTML du
  backend pour la prévisualisation live. Son `escapeHtml` n'échappe pas `'`,
  et elle échappe le sujet pour la prévisualisation alors que le backend envoie
  le sujet littéralement — les aperçus peuvent différer de l'email délivré.
- Le graphique du dashboard fabrique des données quotidiennes à partir des
  totaux (voir §8.6).
- `Layout.astro` ignore sa prop `title` et code en dur `<title>Astro
  Basics</title>`.
- Il n'y a pas de tests frontend ni de scripts de lint.

---

## 14. Déploiement et environnements

### 14.1 Local

- `backend/.dev.vars` est ce que lit Wrangler ; `.env.example` mentionne
  `.env`, mais pour le Worker utilisez `.dev.vars` (ou passez des vars avec
  `wrangler dev --var`).
- Migrations D1 : `pnpm exec wrangler d1 migrations apply makisend_db --local`.
- `pnpm dev` dans `backend/` lance `wrangler dev --local` ; Miniflare simule
  D1, Queues et Workflows.
- `pnpm --filter ./frontend dev` lance Astro sur le port 4321 et proxifie vers
  8787.
- Docker Compose lance les deux avec des bind mounts ; l'état D1 local persiste
  dans `backend/.wrangler`.

### 14.2 Production

`.github/workflows/deploy.yml` :

- Déclenché sur **chaque push vers n'importe quelle branche**, plus
  `workflow_dispatch`.
- Job build : install, lint backend, test backend, build frontend, upload de
  `frontend/dist`.
- Job deploy : **supprime et recrée la base D1 de production à chaque
  déploiement**, réécrit `database_id` dans `wrangler.jsonc`, applique les
  migrations, s'assure que la file existe, déploie le Worker, vérifie que les
  quatre secrets existent (il ne les définit pas), commente l'URL de production
  sur une PR ouverte.
- Job preview (PRs du même dépôt) : supprime/recrée `makisend-db-preview`,
  utilise la file/workflow preview, déploie `--env preview`, commente l'URL de
  preview.
- Les secrets doivent être provisionnés une fois à la main : `AES_256_KEY`,
  `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `FRONTEND_URL`.
  `BETTER_AUTH_URL` et `FRONTEND_URL` doivent être l'URL du Worker de
  production car UI et API partagent une origine.
- La CI (`.github/workflows/ci.yml`) ne lance que lint + tests sur les PR vers
  `main`/`dev`. Elle n'exécute **pas** `tsc`.

### 14.3 Docker

- `Dockerfile` racine (Node 22 + pnpm 11), `docker-compose.yml` avec `backend`
  (Wrangler sur 8787) et `frontend` (Astro sur 4321, `BACKEND_URL`).
- Scripts racine : `pnpm docker:build|up|down|test|lint|migrate`.
- Les secrets ne sont pas intégrés à l'image ; `.dev.vars` est bind-monté.

---

## 15. Décisions de conception et compromis

| Décision | Pourquoi | Coût |
|---|---|---|
| HTTP → Queue → Workflow → SMTP | Découple la réponse 202 d'un dial SMTP long et faillible ; retries durables ; les rafales sont tamponnées | Cohérence à terme ; livraison visible seulement dans les logs ; plus de pièces mobiles |
| Une tentative SMTP par exécution, retries via cycles de file | SMTP n'est pas idempotent ; la classification se fait in-process là où l'erreur est la plus riche | Jusqu'à 6 tentatives sur ~1h pour les erreurs transitoires ; les erreurs de config absente gaspillent l'échelle |
| `retries: { limit: 0 }` sur l'étape SMTP | Empêche les envois en double des retries par défaut de Workflows | Repose sur l'échelle des cycles de file pour tous les retries |
| Les callbacks d'étape renvoient des primitives (string/JSON) | Évite la fausse annulation "hung" de workerd | `JSON.parse` peu élégant à l'étape 5 |
| Configs SMTP par utilisateur chiffrées dans D1 | Pas de secrets SMTP au niveau Worker ; prêt pour le multi-tenant | Pas de rotation de clé ; le CRUD de config renvoie les secrets déchiffrés |
| Rendu des templates à la requête | File/workflow/SMTP restent agnostiques des templates ; les variables manquantes échouent vite en 400 | La sortie rendue contourne les caps DTO ; la logique de preview est dupliquée |
| Un seul Worker sert UI + API | Pas de CORS en production, un déploiement, une URL | Le build frontend doit précéder le déploiement ; limites de taille/assets du Worker |
| D1 + Drizzle | SQLite serverless, simulation locale simple, schéma typé | Limites de paramètres D1, pas de longues transactions, latence à l'échelle |
| DI manuelle via getters | Hono n'a pas d'IoC ; controllers testables | État singleton au niveau module ; invalidation partielle du cache auth |
| Pino vers console | Fonctionne sur Workers sans transport Node | Pas de sink structuré, pas de corrélation de requêtes |

---

## 16. Limites connues (consolidées)

**Correction / données**

- Livraison at-least-once ; emails en double possibles après un ack perdu ou un
  crash entre succès SMTP et reçu en base.
- La pagination par curseur décode mal et saute des lignes.
- Les stats dashboard comptent un email à la fois en succès et en échec s'il a
  réussi après retry ; le dénominateur du taux inclut les pending.
- `dashboard/by-config` omet les configs sans clé API.
- Les données du graphique frontend sont fabriquées à partir des totaux.
- Les `email_histories` sont orphelins quand un utilisateur est supprimé.
- Une config SMTP absente est classée transitoire et consomme toute l'échelle
  de retry.

**Sécurité**

- CORS reflète n'importe quelle origine avec credentials ; `x-api-key` manque
  dans `allowHeaders`.
- Les mots de passe SMTP sont renvoyés par `GET /smtp-config`.
- Les messages d'erreur bruts sont renvoyés sur les 500 non gérés.
- Les adresses destinataires et query strings sont loguées en clair.
- Le texte d'erreur SMTP brut est stocké dans l'historique `attempt_failed`.
- Pas de rotation/version de clé.
- Pas de rate limiting en bordure au-delà des 10k/jour par clé de Better Auth.

**Opérations**

- Les D1 production et preview sont effacées à chaque déploiement.
- Pas de consommateur/rapport de DLQ.
- Pas de métriques/traces/alerting ; pas de request ids.
- Pas de `tsc` en CI ; des erreurs de type connues existent dans les tests.
- `worker-configuration.d.ts` est obsolète et suivi par git.
- Le `package.json` racine n'a pas de scripts `dev`/`test`/`lint` ; le
  `pnpm dev` racine du README est trompeur.

**Produit / protocole**

- `secure: true` codé en dur → 587/STARTTLS non supporté.
- Un seul fournisseur SMTP par clé ; pas de failover.
- Pas de tracking bounce/open/click, pas de webhooks.
- Pas de gestion SPF/DKIM/DMARC.
- L'inscription est fermée après le premier utilisateur.
- `create-user.ts` est un bootstrap legacy réservé aux clés API qui crée un
  email synthétique ; il ne permet pas la connexion email/mot de passe Better
  Auth.

---

## 17. Où regarder

| Sujet | Fichier |
|---|---|
| Point d'entrée Worker, ordre des middlewares, DI | `backend/src/index.ts` |
| Bindings → config typée | `backend/src/config/config.ts` |
| Auth (sessions, clés API, hook de suppression) | `backend/src/lib/auth.ts` |
| Middleware clé API | `backend/src/middleware/api-key.middleware.ts` |
| Endpoint d'envoi | `backend/src/send-email/send-email.controller.ts` |
| Schémas de payload | `backend/src/send-email/send-email.dto.ts` |
| Transport SMTP | `backend/src/send-email/index.ts` |
| Résolution du transport | `backend/src/send-email/transport-resolver.ts` |
| Classification d'erreurs | `backend/src/send-email/error-classifier.ts` |
| Consommateur de file | `backend/src/queue/send-email.consumer.ts` |
| Workflow durable + décision de retry | `backend/src/workflows/send-email.workflow.ts` |
| Rendu de templates | `backend/src/templates/template-renderer.ts` |
| Schéma | `backend/src/db/schema.ts` |
| Crypto | `backend/src/core/crypto.ts` |
| Sanitizer HTML | `backend/src/core/html-sanitizer.ts` |
| Logs + pagination | `backend/src/email-logs/email-logs.repository.ts` |
| Requêtes dashboard | `backend/src/dashboard/dashboard.repository.ts` |
| Déploiement | `backend/wrangler.jsonc`, `.github/workflows/deploy.yml` |
| Helper API frontend | `frontend/src/lib/api.ts` |
| Proxy de dev frontend | `frontend/astro.config.mjs` |

---

*Voir `DEVELOPER_GUIDE.fr.md` pour l'installation, les commandes, les tests,
les recettes et une checklist de réutilisation. Version anglaise :
`ARCHITECTURE.md`.*
