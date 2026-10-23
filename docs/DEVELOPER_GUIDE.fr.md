# MakiSend — Guide développeur & agent

> Complément de `ARCHITECTURE.fr.md`. Ce guide est orienté tâches : faire
> tourner le projet, modifier le code sans casser les invariants, tester,
> déboguer et savoir ce qu'il faut éviter.
>
> Version anglaise : `DEVELOPER_GUIDE.md`.

---

## 1. Prérequis

- Node.js **22+**
- **pnpm 11** (`corepack enable && corepack prepare pnpm@11 --activate`)
- Un compte Cloudflare avec Workers, D1, Queues et Workflows (uniquement pour
  déployer ; le développement local est entièrement simulé par Miniflare)
- Un compte fournisseur SMTP avec host/username/password/expéditeur
  (SendGrid, Resend, Mailgun, Postmark, Amazon SES, …)
- Optionnel : Docker + Docker Compose pour la stack conteneurisée

---

## 2. Premier lancement

```bash
# Depuis la racine — installe les deux packages du workspace
pnpm install

# Secrets/vars locaux du Worker
cp backend/.env.example backend/.dev.vars
# éditer backend/.dev.vars (voir §3)

# Créer le schéma D1 local
cd backend
pnpm exec wrangler d1 migrations apply makisend_db --local

# Terminal 1 — API Worker sur http://localhost:8787
pnpm dev

# Terminal 2 — dashboard Astro sur http://localhost:4321
pnpm --filter ./frontend dev
```

> `wrangler dev` lit **`backend/.dev.vars`**, pas `.env`. L'en-tête de
> `.env.example` est hérité de l'ancienne configuration ; utilisez `.dev.vars`
> pour tout ce dont le Worker a besoin en local. `backend/.dev.vars` est ignoré
> par git.

Ouvrez `http://localhost:4321`, inscrivez le **premier** utilisateur
(l'inscription se ferme ensuite), puis dans le dashboard :

1. **SMTP Config** → créer une config (host, username, password, sender email).
2. **API Keys** → créer une clé liée à cette config SMTP. Copiez immédiatement
   la valeur `mk_...` ; elle n'est affichée qu'une fois.
3. **Templates** (optionnel) → en créer un dans l’éditeur visuel ou coller un composant React Email TSX avec des `{{variables}}`.
4. Envoyer un email de test avec `curl` (§4).

---

## 3. Configuration

### 3.1 Bindings du Worker

| Nom | Où | Notes |
|---|---|---|
| `AES_256_KEY` | secret / `.dev.vars` | 64 caractères hex ; `openssl rand -hex 32` |
| `BETTER_AUTH_SECRET` | secret / `.dev.vars` | longue chaîne aléatoire |
| `BETTER_AUTH_URL` | secret / `.dev.vars` | URL du Worker (`http://localhost:8787` en local) |
| `FRONTEND_URL` | secret / `.dev.vars` | origine du dashboard (`http://localhost:4321` en local) |
| `PORT` | var `wrangler.jsonc` | port SMTP ; `"465"` aujourd'hui (chaîne dans Wrangler) |
| `makisend_db` | `wrangler.jsonc` | binding D1 |
| `SEND_EMAIL_QUEUE` | `wrangler.jsonc` | producteur de file |
| `SEND_EMAIL_WORKFLOW` | `wrangler.jsonc` | binding Workflow |
| `ASSETS` | `wrangler.jsonc` | `../frontend/dist` |

**N'ajoutez pas** d'identifiants SMTP ni de clés API comme secrets Worker : ce
sont des lignes par utilisateur dans D1, chiffrées avec `AES_256_KEY`.

`backend/.dev.vars` contient encore des entrées legacy `SMTP_USER`,
`SMTP_PASSWORD`, `SENDER_EMAIL` et `HOST`. Elles sont ignorées par le code ;
supprimez-les pour éviter la confusion.

### 3.2 Validation de la config

`createConfig` (`backend/src/config/config.ts`) valide :

- `AES_256_KEY` est présent et correspond à `^[0-9a-fA-F]{64}$`.
- `makisend_db` est présent.

Il ne valide **pas** `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `FRONTEND_URL`
ni `PORT`. Une valeur d'auth manquante se manifeste plus tard par des échecs
Better Auth opaques ; un `PORT` manquant peut faire retomber nodemailer sur
465.

### 3.3 Frontend

- `frontend/astro.config.mjs` lit `BACKEND_URL` (défaut
  `http://localhost:8787` ; Docker met `http://backend:8787`).
- La production n'a besoin d'aucune URL d'API : le Worker sert UI et API sur la
  même origine et `fetchApi` utilise un chemin relatif.

---

## 4. Référence rapide de l'API

### 4.1 Envoyer un email inline

```bash
curl -i http://localhost:8787/send-email \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mk_votre_cle" \
  -d '{
    "to": "vous@example.com",
    "subject": "Hello from MakiSend",
    "text": "Ceci est le corps texte (au moins 10 caractères).",
    "html": "<p>Ceci est le corps <strong>HTML</strong>.</p>"
  }'
```

`202 {"success":true,"message":"Email queued"}` signifie que le message est
dans la file — pas délivré. Interrogez `GET /email-logs` ou surveillez les logs
de `wrangler dev`.

`x-api-key: mk_votre_cle` est équivalent à l'en-tête `Authorization`.

### 4.2 Envoyer avec un template

```bash
curl -i http://localhost:8787/send-email \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mk_votre_cle" \
  -d '{
    "to": "vous@example.com",
    "templateId": "id_du_template_du_dashboard",
    "variables": { "username": "Gedeon", "orderId": 42 }
  }'
```

Règles :

- Variable manquante → `400` listant les noms.
- Template inconnu/étranger → le même `404`.
- Mélange de champs inline et `templateId` → `400`.
- Les valeurs de variable peuvent être string, number ou boolean ; elles sont
  converties en chaînes.

### 4.3 Endpoints du dashboard (cookie de session)

| Méthode | Chemin | Rôle |
|---|---|---|
| GET/POST | `/smtp-config` | lister / créer |
| GET/PUT/DELETE | `/smtp-config/:id` | lire / mettre à jour / supprimer |
| GET/POST | `/api-keys` | lister / créer (body : `smtpConfigId`, `name` optionnel) |
| DELETE | `/api-keys/:id` | révoquer |
| GET/POST | `/templates` | lister / créer |
| GET/PUT/DELETE | `/templates/:id` | lire / mettre à jour / supprimer |
| POST | `/templates/:id/preview` | rendre le template enregistré avec des variables d’exemple |
| GET | `/email-logs?limit=&cursor=&status=&smtpConfigId=&to=` | logs paginés |
| GET | `/email-logs/:id` | un log + historique |
| GET | `/dashboard/stats?days=7` | totaux + taux de succès |
| GET | `/dashboard/by-config?days=7` | par config SMTP |
| GET | `/dashboard/recent?limit=20` | envois récents |
| GET | `/dashboard/errors?days=7&limit=10` | échecs groupés |

Les routes d'auth vivent sous `/api/auth/*` (Better Auth). L'inscription est
fermée dès qu'un utilisateur existe.

---

## 5. Commandes

Il n'y a **aucun script racine `dev`/`test`/`lint`**. Lancez les commandes
backend depuis `backend/` ou avec un filtre.

| Tâche | Commande |
|---|---|
| Tout installer | `pnpm install` (racine) |
| Serveur de dev Worker | `cd backend && pnpm dev` |
| Serveur de dev frontend | `pnpm --filter ./frontend dev` |
| Build frontend | `pnpm --filter ./frontend build` |
| Lint backend | `cd backend && pnpm lint` |
| Auto-fix lint | `cd backend && pnpm lint:fix` |
| Tests (watch) | `cd backend && pnpm test` |
| Tests (une fois) | `cd backend && pnpm test:run` |
| UI des tests | `cd backend && pnpm test:ui` |
| Couverture | `cd backend && pnpm test:coverage` |
| Régénérer les types Worker | `cd backend && pnpm cf-typegen` |
| Générer une migration | `cd backend && pnpm db:generate` |
| Appliquer les migrations (local) | `cd backend && pnpm exec wrangler d1 migrations apply makisend_db --local` |
| Appliquer les migrations (remote) | `cd backend && pnpm exec wrangler d1 migrations apply makisend_db --remote` |
| Déployer | `cd backend && pnpm deploy` (build frontend d'abord) |
| Suivre les logs de prod | `cd backend && pnpm exec wrangler tail` |
| Bootstrap utilisateur legacy | `cd backend && pnpm user:create` |

> `pnpm --filter backend ...` ne fonctionne **pas** : le package s'appelle
> `makisend-poc`. Utilisez `pnpm --filter ./backend ...`, `cd backend`, ou
> `pnpm --filter makisend-poc ...`.

### 5.1 Docker

```bash
pnpm docker:build
pnpm docker:up        # API :8787, UI :4321
pnpm docker:down
pnpm docker:test      # docker compose run --rm backend pnpm test:run
pnpm docker:lint
pnpm docker:migrate
```

Ne lancez pas le serveur de dev hôte en même temps que le conteneur (conflit
sur le port 8787). L'état D1 local persiste dans `backend/.wrangler`.

---

## 6. Tests

### 6.1 Organisation

```
backend/test/
├── setup.ts                     # clear des mocks avant chaque test
├── helpers/d1-setup.ts          # vraie D1 Miniflare + migrations
├── mocks/cloudflare-workers.ts  # stub WorkflowEntrypoint pour Node
├── integration/full-flow.test.ts
└── unit/
    ├── api-keys/ auth/ config/ core/ dashboard/ email-logs/
    ├── middleware/ queue/ send-email/ send-emails/ settings/
    ├── smtp-config/ templates/ workflows/
```

Référence actuelle : **30 fichiers / 308 tests passent** en ~40 s avec
`pnpm test:run`. Le lint et `pnpm exec tsc --noEmit` passent.

La CI ne lance pas `tsc` ; lancez-le manuellement avant d’affirmer que le
typechecking est propre.

### 6.2 Comment les tests sont câblés

- `vitest.config.ts` alias `@/` via `vite-tsconfig-paths` et remplace
  `cloudflare:workers` par `test/mocks/cloudflare-workers.ts`.
- `createTestD1()` démarre un vrai processus Miniflare `workerd` avec D1, lit
  tous les `drizzle/*.sql`, découpe sur `--> statement-breakpoint`, convertit
  les backticks en guillemets doubles et exécute chaque instruction. Les
  nouvelles migrations sont prises en compte automatiquement.
- Toujours `cleanupTestD1(mf)` dans `afterEach`/`afterAll`.
- Les tests de controller le montent sur un `Hono` frais avec `errorHandler`,
  et injectent `userId`/`apiKeyId`/`smtpConfigId` via un middleware qui imite
  `apiKeyMiddleware`.
- Les tests de workflow utilisent un stub `WorkflowStep` qui exécute les
  callbacks et peut capturer la config par étape (utilisé pour vérifier
  `retries: { limit: 0 }`).

### 6.3 Que tester quand vous changez quelque chose

| Changement | Tests minimum |
|---|---|
| DTO / validation | invalide, manquant, champ en trop, bornes de longueur |
| Controller | code de statut, payload de file, log pending, chemin d'erreur |
| Renderer de template | ordre d’extraction, espaces, marqueurs malformés, échappement HTML, variables manquantes/prototype, caps de rendu |
| Sauvegarde de l’éditeur | le DTO accepte `format` + `editorJson`/`source`, exige le JSON pour `react-email` et la source pour `react-email-code`, la route preview rend le contenu stocké |
| Étape de workflow | séquence d'historique, forme primitive retournée, config d'étape |
| Classifier d'erreurs | `responseCode`, statut SMTP dans le message, `err.code`, token du message, défaut |
| Décision de retry | requeue + backoff, plafond de cycles, permanent, file absente, échec de ré-enqueue |
| Consommateur de file | ack après create, délai de retry, historique du dernier essai, id d'instance |
| Repository | filtres, pagination, portée par utilisateur, attachement de l'historique |
| Auth | 401 manquant, 403 invalide, câblage de session |
| Crypto | aller-retour, IV frais, chaîne vide, clé malformée |

### 6.4 Ajouter un fichier de test

1. Le placer sous `backend/test/unit/<module>/`.
2. Importer `{ describe, it, expect, vi }` depuis `vitest` (les globales
   existent mais la suite est explicite).
3. Utiliser `createTestD1`/`cleanupTestD1` seulement si vous avez besoin du
   vrai comportement SQL.
4. Lancer `pnpm test:run` depuis `backend/`.

---

## 7. Workflow base de données

Schéma : `backend/src/db/schema.ts`. Migrations : `backend/drizzle/`.

```bash
cd backend
# 1. Modifier src/db/schema.ts
pnpm db:generate                  # crée drizzle/000N_*.sql + snapshot meta
pnpm exec wrangler d1 migrations apply makisend_db --local
pnpm test:run                     # le helper Miniflare charge le nouveau SQL
```

Règles :

- Ne jamais modifier une migration déjà appliquée. Ajoutez-en une nouvelle.
- Le SQL généré utilise des backticks ; le helper de test les convertit en
  guillemets doubles pour D1. Gardez le format généré.
- D1 a une **limite de 100 paramètres liés par requête** — voir
  `MAX_PAGE_SIZE = 100` dans `email-logs.repository.ts`. Évitez les `inArray`
  non bornés.
- Timestamps : les tables Better Auth utilisent `timestamp_ms` (entier) ;
  `email_logs` et `email_histories` utilisent du texte ISO. Ne mélangez pas les
  deux dans une comparaison.
- Clés étrangères : `email_logs.userId` n'a volontairement pas de FK ; la
  suppression d'un utilisateur est gérée par le hook `beforeDelete` de Better
  Auth. `email_histories.emailId` n'a pas de FK non plus — pensez au nettoyage
  si vous ajoutez une logique de suppression.
- Pour ajouter une colonne chiffrée, chiffrez/déchiffrez dans le service,
  jamais dans le repository, et couvrez le champ dans `crypto.test.ts` s'il a
  un traitement spécial.

---

## 8. Ajouter une fonctionnalité

### 8.1 Nouveau module backend (pattern CRUD)

Utilisez `templates/` comme modèle :

1. `src/<module>/<module>.types.ts` — record, input/update input, interface de
   repository.
2. `src/<module>/<module>.dto.ts` — schémas Zod avec `.strict()` et caps.
3. `src/<module>/<module>.repository.ts` — Drizzle uniquement ; implémente
   l'interface.
4. `src/<module>/<module>.service.ts` — règles métier, vérifications de
   propriété (`AppError(404)` si absent, `403` si étranger), chiffrement si
   nécessaire.
5. `src/<module>/<module>.controller.ts` — `zValidator`, lire
   `c.get("userId")`, appeler le service, renvoyer du JSON.
6. `src/<module>/index.ts` — barrel export.
7. Câbler dans `src/index.ts` :
   - ajouter les champs nullables dans `deps` ;
   - construire le repository dans `initDb` ;
   - construire le service dans `initServices` ;
   - monter le controller avec un getter ;
   - ajouter `sessionMiddleware` (ou `apiKeyMiddleware` pour un endpoint
     machine).
8. Ajouter le chemin au proxy de dev Astro dans `frontend/astro.config.mjs` si
   le frontend doit l'appeler.
9. Ajouter des tests unitaires (service + HTTP) et, si ça touche D1, un test
   Miniflare.

### 8.2 Nouvelle route sur un module existant

- Controller uniquement : valider → appeler le service → renvoyer.
- Ne jamais instancier un repository dans le controller.
- Ne jamais lire `c.env` dans un controller ; utilisez
  `c.get("appConfig")` ou le service injecté.
- Lever `AppError` pour les échecs attendus ; ne renvoyez pas de formes
  d'erreur ad hoc.

### 8.3 Nouvelle table + module

1. Ajouter la table Drizzle et les index.
2. `pnpm db:generate` + appliquer en local.
3. Ajouter explicitement le comportement de suppression (cascade FK vs purge
   applicative).
4. Si la table appartient à l'utilisateur, ajouter `userId` + un index dessus.
5. Si chiffrée, chiffrer dans le service et déchiffrer à la lecture.
6. Rien à ajouter dans `backend/test/helpers/d1-setup.ts` : il charge toutes
   les migrations.

### 8.4 Modifier le pipeline d'envoi

Ordre des préoccupations :

1. **DTO** (`send-email.dto.ts`) — forme de la requête et caps.
2. **Controller** — résolution du template, log pending, payload de file.
3. **Types** (`send-email.types.ts`) — forme du message de file.
4. **Consommateur de file** — id d'instance, ack/retry.
5. **Workflow** — étapes, lignes d'historique, valeurs de retour primitives.
6. **Classifier** — permanent/transitoire + message lisible.
7. **Transport resolver / transport** — recherche de config et options
   nodemailer.

Règles absolues :

- **N'ajoutez jamais de retries automatiques à l'étape SMTP.** SMTP n'est pas
  idempotent. Gardez `retries: { limit: 0 }`.
- **Les étapes doivent renvoyer des primitives.** Renvoyez une chaîne ; si vous
  avez plusieurs valeurs, `JSON.stringify` et parsez à l'étape suivante.
  Renvoyer un objet déclenche la fausse annulation "hung" de workerd.
- **Une tentative SMTP par exécution.** Les retries appartiennent à l'échelle
  des cycles de file.
- **Écrivez une ligne d'historique pour chaque chemin terminal**, y compris
  l'abandon et l'épuisement DLQ, pour que le dashboard ne perde jamais un email
  silencieusement.
- **Gardez `FINAL_ATTEMPT` synchronisé** avec le `max_retries` de la file dans
  `wrangler.jsonc`.
- **Gardez le format d'id d'instance** `${emailId}-${queueCycles}` ; les ids
  Workflow n'autorisent que `[a-zA-Z0-9-_]`.
- **Ne mettez pas de secrets ni de listes complètes de destinataires dans les
  logs.** Les adresses destinataires sont déjà loguées en clair — n'aggravez
  pas.

### 8.5 Ajouter une étape de workflow

```ts
const value = await step.do("my-step", async () => {
  // travail
  return "une primitive"; // string/number/boolean/null
});
```

- Gardez les effets de bord idempotents quand c'est possible ; les étapes
  peuvent être réessayées.
- Si l'étape est l'envoi SMTP, mettez `retries: { limit: 0 }`.
- Si elle doit faire échouer l'exécution dans le classifier, levez une `Error`
  simple (éventuellement avec un `code`) ou une `AppError` ; le workflow
  attrape et classe.
- Mettez à jour la timeline d'historique et les tests du workflow.

### 8.6 Ajouter une fonctionnalité de variables de template

Le renderer est partagé par le controller, l’endpoint preview et la preview
live du frontend. Si vous changez la syntaxe :

1. Mettre à jour `VARIABLE_PATTERN` dans
   `backend/src/templates/template-renderer.ts`.
2. Mettre à jour la regex/échappement dupliqués dans
   `frontend/src/components/templates-layout.tsx`.
3. Mettre à jour `template-renderer.test.ts`.
4. Décider l'échappement par champ : sujet/texte littéral, HTML échappé.
5. Garder la vérification des variables manquantes sur
   `Object.prototype.hasOwnProperty` (les noms de prototype ne doivent pas
   passer).
6. `renderTemplateContent` re-plafonne la sortie rendue ; l’endpoint preview
   doit continuer à l’utiliser.
7. L’éditeur visuel stocke `format: "react-email"`, une enveloppe `editorJson`
   (`{ version: 2, theme, content }`) et les champs `html`/`text` exportés. Il
   monte le builder complet `@react-email/editor` : canvas, inspecteur
   (couleurs/espacement/bordure body, container et nœuds), thèmes Basic/Minimal
   et Export HTML. Le Worker ne doit pas exécuter de TSX collé.

### 8.7 Page frontend

- Ajouter une page Astro sous `frontend/src/pages/dashboard/` qui monte un
  layout React avec `client:load`.
- Envelopper le contenu protégé dans `SessionGuard` (client-side uniquement ;
  l'API est la vraie barrière).
- Utiliser `fetchApi` de `@/lib/api` pour envoyer les cookies.
- Ajouter le chemin API au proxy de dev dans `frontend/astro.config.mjs`.
- Suivre les composants shadcn/Base UI existants ; ne pas introduire une
  nouvelle librairie UI.
- La page templates est l’exception : elle importe `@react-email/editor` dans
  une île React et persiste le HTML/texte exporté ainsi que l’enveloppe du
  builder. Le mode visuel inclut l’inspecteur, le sélecteur de thème et Export
  HTML. Ne jamais exécuter l’éditeur ni du TSX collé dans le Worker.
- Il n'y a pas de setup test/lint frontend ; au minimum lancer
  `pnpm --filter ./frontend build` et tester la page manuellement.

---

## 9. Débogage

### 9.1 Local

- `wrangler dev` affiche les lignes JSON Pino dans le terminal.
- État D1 : `backend/.wrangler/state/v3/d1`.
- Inspecter la base :
  `cd backend && pnpm exec wrangler d1 execute makisend_db --local --command "select * from email_logs order by created_at desc limit 10"`
- File/workflow sont simulés ; une exécution de workflow apparaît dans les logs
  de dev avec les noms d'étapes.
- Si le frontend reçoit `401`, vérifiez le cookie de session et
  `FRONTEND_URL`.
- Si l'API marche avec `curl` mais pas dans le navigateur, vérifiez CORS
  (`Authorization` est autorisé ; `x-api-key` n'est **pas** dans
  `allowHeaders`).

### 9.2 Production

```bash
cd backend
pnpm exec wrangler tail                      # logs live
pnpm exec wrangler d1 execute makisend_db --remote --command "select ..."
pnpm exec wrangler queues list
pnpm exec wrangler workflows list
```

Le détail d'un email dans le dashboard affiche la timeline d'historique
(`received`, `processing`, `cleaned`, `sent`, `attempt_failed`, `failed`). La
colonne `error` explique pourquoi un envoi s'est arrêté.

### 9.3 Symptôme → cause

| Symptôme | Cause probable / correction |
|---|---|
| `500 AES_256_KEY ...` sur chaque requête | Clé absente/malformée. Utilisez exactement 64 caractères hex. |
| `403 Invalid API Key` | Clé révoquée/faute de frappe ; préfixe `mk_` ; vérifiez `x-api-key` ou Bearer. |
| `403 API key has no SMTP configuration` | Créez une config SMTP et une clé liée. |
| `403 Registration is closed` | Un utilisateur existe déjà. Connectez-vous, ou videz la D1 locale. |
| Email bloqué à `received`/`processing` | Binding workflow/file absent ou consommateur non lancé en local. |
| `attempt_failed` répété, puis `failed` après ~1h | Erreur transitoire ayant atteint le plafond de 5 cycles. Inspectez la dernière erreur. |
| `failed` immédiat avec message d'identifiants | `EAUTH`/`535` — mauvais username/password SMTP ou mot de passe applicatif requis. |
| "Outbound port 25 is blocked" | Workers bloquent le port 25. Utilisez 465 (TLS implicite) ou 587 (nécessite un changement de code — `secure` est codé en dur `true`). |
| Erreur TLS sur 587 | `SmtpEmailTransport` code `secure: true` ; 587 nécessite `secure: false` + STARTTLS. |
| Config SMTP absente qui retente 5 fois | Connu : `AppError(404)` n'a pas de code → le classifier passe en transitoire. |
| Email délivré deux fois | Pipeline at-least-once ; un crash entre succès SMTP et étape 5 peut ré-enfiler. Pas de dédup aujourd'hui. |
| `400 Validation failed` | Zod `.strict()` a rejeté un champ en trop ou un cap de longueur. |
| `400 Missing template variables` | Fournissez chaque `{{name}}` utilisé dans subject/html/text. |
| `404 Template not found` | Mauvais id ou appartient à un autre utilisateur (anti-sondage volontaire). |
| Échec d'enqueue pour taille | Le template rendu a dépassé la limite de 128 Ko de la file ; `renderTemplateContent` devrait le rejeter avant. |
| La pagination des logs saute des lignes | Bug de curseur connu (`:` dans le timestamp ISO). Corrigez `encode/decodeCursor` avant de vous appuyer sur la pagination. |
| Le taux de succès du dashboard semble faux | Connu : double comptage succès+échec, pending au dénominateur. |
| `GET /smtp-config` expose les mots de passe | Problème de sécurité connu ; ne construisez pas d'UI qui en dépend, et corrigez avant la production. |
| `pnpm --filter backend` ne fait rien | Le package s'appelle `makisend-poc` ; utilisez `./backend`. |
| Types `wrangler` obsolètes | `pnpm cf-typegen` ; ne modifiez pas `worker-configuration.d.ts` à la main. |

### 9.4 Réinitialiser l'état local

```bash
cd backend
rm -rf .wrangler
pnpm exec wrangler d1 migrations apply makisend_db --local
```

Réinscrivez ensuite le premier utilisateur. Les clés API/configs SMTP locales
sont perdues.

---

## 10. Déploiement

### 10.1 Manuel

```bash
pnpm --filter ./frontend build      # requis : le Worker sert frontend/dist
cd backend
pnpm exec wrangler d1 migrations apply makisend_db --remote
pnpm exec wrangler queues create makisend-send-email   # première fois seulement
pnpm deploy
```

Secrets (une fois par environnement) :

```bash
cd backend
echo "<64 caractères hex>" | pnpm exec wrangler secret put AES_256_KEY
echo "<aléatoire>"         | pnpm exec wrangler secret put BETTER_AUTH_SECRET
echo "https://<worker-url>" | pnpm exec wrangler secret put BETTER_AUTH_URL
echo "https://<worker-url>" | pnpm exec wrangler secret put FRONTEND_URL
```

`BETTER_AUTH_URL` et `FRONTEND_URL` doivent être l'URL du Worker car UI et API
partagent une origine. La preview utilise les mêmes noms de secrets sur le
Worker de preview.

### 10.2 CI/CD

- `.github/workflows/ci.yml` — PRs vers `main`/`dev` : lint + tests backend.
  Pas de `tsc`, pas de vérifications frontend.
- `.github/workflows/deploy.yml` — **chaque push sur n'importe quelle branche
  déploie en production** ; les PRs du même dépôt obtiennent aussi un
  déploiement preview.
  - Job build : lint, tests, build frontend, upload de l'artefact.
  - Job production : **supprime et recrée la base D1 de production**, réécrit
    `database_id` dans `wrangler.jsonc`, applique les migrations, s'assure que
    la file existe, déploie, vérifie les secrets, commente l'URL sur la PR.
  - Job preview : idem pour `makisend-db-preview`, file/workflow preview.
- Cela signifie que **les données de production sont jetables** et que
  **chaque branche peut écraser la production**. Ne stockez pas de vraies
  données tant que ce n'est pas changé.

### 10.3 Checklist avant déploiement

- [ ] `cd backend && pnpm lint`
- [ ] `cd backend && pnpm test:run`
- [ ] `pnpm --filter ./frontend build`
- [ ] Migration générée et commitée (`backend/drizzle/*.sql` + meta)
- [ ] Nouveaux bindings/secrets documentés et créés
- [ ] Noms de file/workflow inchangés ou `wrangler.jsonc` mis à jour de façon
      cohérente
- [ ] Aucun secret ni `.dev.vars` stagé
- [ ] Le `database_id` de production dans `wrangler.jsonc` est le bon (le
      workflow de déploiement le réécrit)

---

## 11. Conventions

D'après `AGENTS.md` et le code :

- TypeScript strict ; guillemets doubles ; points-virgules.
- Controllers : HTTP uniquement. Services : logique métier. Repositories :
  persistance.
- DTOs : schémas Zod + `z.infer` ; `.strict()` sur les payloads d'écriture.
- Erreurs : `AppError(status, message)` et sous-classes. Ne pas laisser fuiter
  d'erreurs brutes.
- Logs : `pinoLogger`, objets structurés, pas de transport Node.
- Pas de `Buffer` : utilisez `Uint8Array`, `TextEncoder`/`TextDecoder`, Web
  Crypto.
- Pas de commentaires sauf pour expliquer *pourquoi* (le code utilise des
  commentaires explicatifs pour les décisions non évidentes).
- Les imports utilisent l'alias `@/`.
- `consistent-type-imports` est imposé par ESLint : utilisez `import type`.
- `no-explicit-any` est un warning ; évitez-le, et si c'est inévitable ajoutez
  le commentaire eslint-disable comme le code existant.

### 11.1 Anti-patterns

- Instancier un repository dans une route.
- Mélanger la logique nodemailer/SMTP et la persistance.
- Lire `c.env` dans un controller au lieu du service/config injecté.
- Renvoyer un objet depuis `step.do`.
- Ajouter des retries à l'étape SMTP.
- Stocker des secrets en clair dans des colonnes.
- Ajouter des requêtes `inArray` non bornées (limite de paramètres D1).
- Supposer que `email_logs.apiKeyId` existe encore (il est `SET NULL`).
- Supposer que les templates sont visibles en aval (ils sont rendus avant
  l'enqueue).

---

## 12. Réutiliser / forker ce projet

### 12.1 Ce qui est réellement réutilisable

- Le pipeline HTTP → Queue → Workflow → SMTP, y compris la conception des deux
  couches de retry et le contournement des retours primitifs.
- Le classifier d'erreurs et le mapping des messages lisibles.
- Les helpers AES-256-GCM et le pattern de champs chiffrés.
- La structure modulaire (controller/service/repository/DTO/barrel).
- Le helper de test D1 Miniflare et le setup Vitest.
- Le modèle de déploiement Worker unique UI+API.

### 12.2 Ce qu'il faut changer avant un usage réel

1. **Cycle de vie D1** — retirez les étapes de wipe/recreate de
   `.github/workflows/deploy.yml` ; utilisez uniquement des migrations
   forward.
2. **CORS** — remplacez `origin: (origin) => origin` par une allowlist ;
   ajoutez `x-api-key` à `allowHeaders`.
3. **Réponses SMTP config** — ne renvoyez jamais `smtpPassword` ; adoptez un
   pattern write-only.
4. **Réponses d'erreur** — renvoyez des messages génériques pour les 500 ;
   gardez les détails dans les logs.
5. **Secrets/logs** — redactez les adresses destinataires et les query strings ;
   ajoutez des request ids.
6. **Gestion de clé** — ajoutez versioning/rotation avant de stocker de vraies
   données.
7. **Rate limiting** — ajoutez des limites edge/API (KV, Durable Objects ou
   Workers Rate Limiting) en plus de la limite par clé de Better Auth.
8. **Pagination** — corrigez l'encodage du curseur, ou passez à un curseur
   opaque base64.
9. **Idempotence** — ajoutez une clé de dédup/idempotence fournisseur si les
   doublons sont inacceptables.
10. **Inscription** — remplacez la règle "premier utilisateur uniquement" par
    un vrai flux d'onboarding/invitation si multi-tenant.
11. **Délivrabilité** — configurez SPF/DKIM/DMARC au niveau du
    fournisseur/domaine ; le code ne peut pas le faire pour vous.
12. **Port/TLS** — rendez `secure` configurable si vous avez besoin de
    587/STARTTLS.
13. **Classification de config absente** — traitez les erreurs
    `AppError(404)`/config comme permanentes au lieu de retenter cinq cycles.
14. **Frontend** — corrigez le graphique fabriqué, le titre de `Layout.astro`,
    l'échappement dupliqué, et ajoutez tests/lint.
15. **Dépendances** — révisez `pnpm-lock.yaml`, épinglez Wrangler, et gardez
    `compatibility_date` à jour.

### 12.3 Checklist de fork

- [ ] Renommer Worker, D1, file, DLQ et workflow dans `wrangler.jsonc`
      (production **et** preview).
- [ ] Remplacer le `database_id` de production ; retirer la réécriture CI.
- [ ] Définir `BETTER_AUTH_URL` / `FRONTEND_URL` sur votre domaine.
- [ ] Décider si le Worker sert toujours le frontend (`assets`) ou le sépare.
- [ ] Régénérer `worker-configuration.d.ts` (`pnpm cf-typegen`) et arrêter de
      suivre les types générés obsolètes si possible.
- [ ] Relancer `pnpm lint`, `pnpm test:run`, `pnpm --filter ./frontend build`.
- [ ] Appliquer les correctifs de sécurité du §12.2 avant d'exposer à des
      utilisateurs.
- [ ] Mettre à jour `README.md`, `AGENTS.md` et ces docs pour votre fork.

---

## 13. Checklist agent

Lorsqu'un agent automatique travaille dans ce dépôt, il doit :

1. **Lire avant d'écrire** — `backend/src/index.ts`, le module concerné et le
   test le plus proche.
2. **Respecter l'architecture** — controller/service/repository/DTO ; pas de
   repository dans les routes ; pas de `c.env` dans les controllers.
3. **Préserver les invariants du pipeline d'envoi** — une tentative SMTP,
   retours primitifs des étapes, lignes d'historique terminales, format d'id
   d'instance, synchro `FINAL_ATTEMPT`.
4. **Valider avec Zod** et garder `.strict()`.
5. **Ajouter ou mettre à jour les tests** pour chaque changement de
   comportement.
6. **Lancer** `cd backend && pnpm lint && pnpm test:run` avant de terminer. Ne
   pas prétendre que `tsc` passe sans avoir lancé
   `pnpm exec tsc --noEmit`.
7. **Builder le frontend** (`pnpm --filter ./frontend build`) si vous y avez
   touché.
8. **Ne pas committer** sans demande explicite ; ne jamais committer
   `.dev.vars`, `.env`, `.wrangler`, des secrets ou des artefacts générés.
9. **Ne pas “corriger” silencieusement le wipe D1, CORS ou l'exposition des
   mots de passe** — ce sont des compromis POC assumés ; signalez-les et
   demandez avant de changer le comportement.
10. **Documenter la dérive** — si vous changez des routes, bindings, variables
    d'env ou l'échelle de retry, mettez à jour
    `ARCHITECTURE.md`/`DEVELOPER_GUIDE.md` (les deux langues) et `AGENTS.md`.

---

## 14. Où trouver quoi

| Besoin | Fichier |
|---|---|
| Point d'entrée Worker / DI / ordre des middlewares | `backend/src/index.ts` |
| Config typée | `backend/src/config/config.ts` |
| Better Auth | `backend/src/lib/auth.ts` |
| Middleware clé API | `backend/src/middleware/api-key.middleware.ts` |
| Controller + DTO d'envoi | `backend/src/send-email/send-email.controller.ts`, `send-email.dto.ts` |
| Contrat du message de file | `backend/src/send-email/send-email.types.ts` |
| Transport SMTP | `backend/src/send-email/index.ts` |
| Résolution du transport | `backend/src/send-email/transport-resolver.ts` |
| Classifier d'erreurs | `backend/src/send-email/error-classifier.ts` |
| Consommateur de file | `backend/src/queue/send-email.consumer.ts` |
| Workflow + décision de retry | `backend/src/workflows/send-email.workflow.ts` |
| Renderer de template | `backend/src/templates/template-renderer.ts` |
| Schéma | `backend/src/db/schema.ts` |
| Migrations | `backend/drizzle/` |
| Crypto | `backend/src/core/crypto.ts` |
| Sanitizer | `backend/src/core/html-sanitizer.ts` |
| Logs/pagination | `backend/src/email-logs/email-logs.repository.ts` |
| SQL dashboard | `backend/src/dashboard/dashboard.repository.ts` |
| Helper D1 de test | `backend/test/helpers/d1-setup.ts` |
| Stub de workflow de test | `backend/test/unit/workflows/send-email.workflow.test.ts` |
| Config Worker | `backend/wrangler.jsonc` |
| CI/CD | `.github/workflows/ci.yml`, `deploy.yml` |
| Helper API frontend | `frontend/src/lib/api.ts` |
| Proxy de dev frontend | `frontend/astro.config.mjs` |
| Docs existantes | `README.md`, `AGENTS.md`, `docs/ARCHITECTURE.fr.md` |

---

*Voir `ARCHITECTURE.fr.md` pour la description complète du système et
`ARCHITECTURE.md` / `DEVELOPER_GUIDE.md` pour les versions anglaises.*
